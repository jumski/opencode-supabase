import type { PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { createConnection } from "node:net";

import {
  BrokerClientError,
  exchangeCodeThroughBroker,
  type BrokerConfig,
} from "../shared/broker.ts";
import { readSupabaseConfig } from "../shared/cfg.ts";
import { buildAuthorizeUrl, generatePKCE, generateState } from "../shared/oauth.ts";
import type { FetchLike, SupabaseTokenResponse } from "../shared/types.ts";
import { HTML_SUCCESS, htmlError } from "./auth-html.ts";
import { writeSavedAuth } from "./store.ts";

const CALLBACK_PATH = "/auth/callback";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

type PendingAuth = {
  codeVerifier: string;
  redirectUri: string;
  resolve: (result: { tokens: SupabaseTokenResponse; expires: number }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type AuthDeps = {
  fetch?: FetchLike;
};

let server: ReturnType<typeof Bun.serve> | undefined;
let serverPort: number | undefined;
const pendingAuths = new Map<string, PendingAuth>();

function callbackUrl(port: number) {
  return `http://localhost:${port}${CALLBACK_PATH}`;
}

async function isPortInUse(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(port, "localhost");
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
  });
}

async function ensureServer(
  port: number,
  config: ReturnType<typeof readSupabaseConfig>,
  input: Pick<PluginInput, "directory" | "worktree">,
  deps: AuthDeps,
) {
  if (server) {
    if (serverPort !== port) {
      throw new Error(`Supabase callback server already running on port ${serverPort}`);
    }
    return;
  }

  if (await isPortInUse(port)) {
    throw new Error(`Supabase callback port ${port} is already in use`);
  }

  const brokerConfig: BrokerConfig = {
    baseUrl: config.brokerBaseUrl,
  };

  server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== CALLBACK_PATH) {
        return new Response("Not found", { status: 404 });
      }

      const state = url.searchParams.get("state");
      if (!state) {
        return new Response(htmlError("Missing required state parameter - potential CSRF attack"), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        });
      }

      const pending = pendingAuths.get(state);
      if (!pending) {
        return new Response(htmlError("Invalid or expired state parameter - potential CSRF attack"), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        });
      }

      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      if (error) {
        clearTimeout(pending.timeout);
        pendingAuths.delete(state);
        pending.reject(new Error(errorDescription || error));
        return new Response(htmlError(errorDescription || error), {
          headers: { "Content-Type": "text/html" },
        });
      }

      const code = url.searchParams.get("code");
      if (!code) {
        clearTimeout(pending.timeout);
        pendingAuths.delete(state);
        pending.reject(new Error("Missing authorization code"));
        return new Response(htmlError("Missing authorization code"), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        });
      }

      clearTimeout(pending.timeout);
      pendingAuths.delete(state);

      try {
        const tokens = await exchangeCodeThroughBroker(
          brokerConfig,
          {
            code,
            redirect_uri: pending.redirectUri,
            code_verifier: pending.codeVerifier,
          },
          deps.fetch,
        );

        const expires = Date.now() + (tokens.expires_in || 3600) * 1000;
        await writeSavedAuth(input, {
          access: tokens.access_token,
          refresh: tokens.refresh_token,
          expires,
        });

        pending.resolve({ tokens, expires });

        return new Response(HTML_SUCCESS, {
          headers: { "Content-Type": "text/html" },
        });
      } catch (cause) {
        const errorMessage = cause instanceof BrokerClientError
          ? `Authorization failed: ${cause.message}`
          : "Authorization failed";

        pending.reject(cause instanceof Error ? cause : new Error(String(cause)));

        return new Response(htmlError(errorMessage), {
          status: cause instanceof BrokerClientError && cause.status >= 500 ? 502 : 400,
          headers: { "Content-Type": "text/html" },
        });
      }
    },
  });

  serverPort = port;
}

function waitForCallback(state: string, codeVerifier: string, redirectUri: string) {
  return new Promise<{ tokens: SupabaseTokenResponse; expires: number }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pendingAuths.has(state)) return;
      pendingAuths.delete(state);
      reject(new Error("OAuth callback timeout - authorization took too long"));
    }, CALLBACK_TIMEOUT_MS);

    pendingAuths.set(state, {
      codeVerifier,
      redirectUri,
      resolve,
      reject,
      timeout,
    });
  });
}

export function createSupabaseAuth(
  input: Pick<PluginInput, "directory" | "worktree">,
  options?: PluginOptions,
  deps: AuthDeps = {},
) {
  const config = readSupabaseConfig(options);

  return {
    provider: "supabase",
    methods: [
      {
        type: "oauth" as const,
        label: "Supabase",
        async authorize() {
          await ensureServer(config.oauthPort, config, input, deps);
          const pkce = await generatePKCE();
          const state = generateState();
          const redirectUri = callbackUrl(config.oauthPort);
          const callbackPromise = waitForCallback(state, pkce.verifier, redirectUri);

          return {
            url: buildAuthorizeUrl(config, redirectUri, pkce, state),
            instructions: "Complete Supabase authorization in your browser.",
            method: "auto" as const,
            callback: async () => {
              const { tokens, expires } = await callbackPromise;
              return {
                type: "success" as const,
                access: tokens.access_token,
                refresh: tokens.refresh_token,
                expires,
              };
            },
          };
        },
      },
    ],
  };
}

export async function stopSupabaseAuthServer() {
  if (server) {
    server.stop();
    server = undefined;
    serverPort = undefined;
  }

  for (const [state, pending] of pendingAuths) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("OAuth callback server stopped"));
    pendingAuths.delete(state);
  }
}
