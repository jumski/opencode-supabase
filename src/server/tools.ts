import type { PluginOptions } from "@opencode-ai/plugin";
import type { ToolContext } from "@opencode-ai/plugin/tool";
import { tool } from "@opencode-ai/plugin";

import {
  BrokerClientError,
  refreshTokenThroughBroker,
} from "../shared/broker.ts";
import { supabaseManagementApiFetch } from "../shared/api.ts";
import { readSupabaseConfig } from "../shared/cfg.ts";
import type { FetchLike } from "../shared/types.ts";
import { clearSavedAuth, readSavedAuth, writeSavedAuth, type SavedAuth } from "./store.ts";

type ToolDeps = {
  fetch?: FetchLike;
};

type HostAuthWriter = {
  set(input: {
    path: { id: string };
    query: { directory: string };
    body: {
      type: "oauth";
      access: string;
      refresh: string;
      expires: number;
    };
  }): Promise<unknown>;
};

export type SupabaseToolInput = {
  client: {
    auth: HostAuthWriter;
  };
  directory: string;
  serverUrl: URL;
  worktree: string;
};

type SupabaseToolContext = Pick<
  ToolContext,
  "directory" | "worktree" | "abort" | "sessionID" | "messageID" | "agent" | "metadata" | "ask"
>;

const NOT_CONNECTED_MESSAGE = "Supabase is not connected. Run /supabase first.";
const REFRESH_BUFFER_MS = 30_000;

function isRefreshNeeded(auth: SavedAuth) {
  return auth.expires <= Date.now() + REFRESH_BUFFER_MS;
}

async function executeSupabaseGet(
  input: SupabaseToolInput,
  options: PluginOptions | undefined,
  deps: ToolDeps,
  path: string,
  errorLabel: string,
) {
  const config = readSupabaseConfig(options);
  const auth = await ensureSupabaseToolAuth(input, options, deps);
  const response = await supabaseManagementApiFetch(
    config,
    auth.access,
    path,
    undefined,
    deps.fetch,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to ${errorLabel}: ${response.status} ${body}`.trim());
  }

  return JSON.stringify(await response.json(), null, 2);
}

async function setHostAuth(
  input: Pick<SupabaseToolInput, "client" | "directory">,
  auth: SavedAuth,
) {
  await input.client.auth.set({
    path: { id: "supabase" },
    query: { directory: input.directory },
    body: {
      type: "oauth",
      access: auth.access,
      refresh: auth.refresh,
      expires: auth.expires,
    },
  });
}

async function clearHostAuth(
  input: Pick<SupabaseToolInput, "directory" | "serverUrl">,
  fetchImpl: FetchLike,
) {
  const url = new URL(`/auth/supabase?directory=${encodeURIComponent(input.directory)}`, input.serverUrl);
  const response = await fetchImpl(url.toString(), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Failed to clear host auth: ${response.status}`);
  }
}

export async function ensureSupabaseToolAuth(
  input: SupabaseToolInput,
  options?: PluginOptions,
  deps: ToolDeps = {},
): Promise<SavedAuth> {
  const fetchImpl = deps.fetch ?? fetch;
  const saved = await readSavedAuth(input);
  if (!saved.auth) {
    throw new Error(NOT_CONNECTED_MESSAGE);
  }

  if (!isRefreshNeeded(saved.auth)) {
    return saved.auth;
  }

  const config = readSupabaseConfig(options);

  try {
    const refreshed = await refreshTokenThroughBroker(
      { baseUrl: config.brokerBaseUrl },
      { refresh_token: saved.auth.refresh },
      deps.fetch,
    );

    const nextAuth: SavedAuth = {
      access: refreshed.access_token,
      refresh: refreshed.refresh_token,
      expires: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
    };
    await writeSavedAuth(input, nextAuth);
    try {
      await setHostAuth(input, nextAuth);
    } catch {}
    return nextAuth;
  } catch (error) {
    if (error instanceof BrokerClientError && (error.status === 401 || error.status === 400)) {
      await clearSavedAuth(input);
      try {
        await clearHostAuth(input, fetchImpl);
      } catch {}
      throw new Error(NOT_CONNECTED_MESSAGE);
    }

    if (error instanceof BrokerClientError) {
      throw new Error(`Supabase auth refresh failed: ${error.message}`);
    }
    throw error;
  }
}

export function createSupabaseTools(
  input: SupabaseToolInput,
  options?: PluginOptions,
  deps: ToolDeps = {},
) {
  return {
    supabase_list_organizations: tool({
      description: "List all Supabase organizations for the authenticated user.",
      args: {},
      async execute(_args, _context: SupabaseToolContext) {
        return executeSupabaseGet(input, options, deps, "/organizations", "list organizations");
      },
    }),
    supabase_list_projects: tool({
      description: "List all Supabase projects for the authenticated user.",
      args: {},
      async execute(_args, _context: SupabaseToolContext) {
        return executeSupabaseGet(input, options, deps, "/projects", "list projects");
      },
    }),
    supabase_get_project_api_keys: tool({
      description: "Get the API keys for a Supabase project.",
      args: {
        project_ref: tool.schema.string().describe("Project reference ID"),
      },
      async execute(args, _context: SupabaseToolContext) {
        return executeSupabaseGet(
          input,
          options,
          deps,
          `/projects/${args.project_ref}/api-keys`,
          "get API keys",
        );
      },
    }),
  };
}
