import type { PluginOptions } from "@opencode-ai/plugin";
import type { ToolContext } from "@opencode-ai/plugin/tool";
import { tool } from "@opencode-ai/plugin";

import {
  BrokerClientError,
  refreshTokenThroughBroker,
} from "../shared/broker.ts";
import { supabaseManagementApiFetch } from "../shared/api.ts";
import { readSupabaseConfig } from "../shared/cfg.ts";
import type { SupabaseLogger } from "../shared/log.ts";
import type { FetchLike } from "../shared/types.ts";
import { clearSavedAuth, readSavedAuth, writeSavedAuth, type SavedAuth } from "./store.ts";

type ToolDeps = {
  fetch?: FetchLike;
  logger?: SupabaseLogger;
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

function generateRandomString(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, length);
}

function sanitizeToolArgs(name: string, args: Record<string, unknown>) {
  const next = { ...args };
  if (name === "supabase_create_project" && typeof next.db_pass === "string") {
    next.db_pass = "[redacted]";
  }
  return next;
}

async function executeSupabaseRequest(
  input: SupabaseToolInput,
  options: PluginOptions | undefined,
  deps: ToolDeps,
  toolName: string,
  context: SupabaseToolContext,
  path: string,
  errorLabel: string,
  init?: RequestInit,
) {
  const startedAt = Date.now();
  await deps.logger?.info("supabase tool started", {
    tool: toolName,
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
  });
  const config = readSupabaseConfig(options);
  const auth = await ensureSupabaseToolAuth(input, options, deps);
  const response = await supabaseManagementApiFetch(
    config,
    auth.access,
    path,
    init,
    deps.fetch,
  );

  await deps.logger?.debug("supabase api response received", {
    tool: toolName,
    path,
    status: response.status,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    await deps.logger?.error("supabase tool failed", {
      tool: toolName,
      path,
      status: response.status,
    });
    throw new Error(`Failed to ${errorLabel}: ${response.status} ${body}`.trim());
  }

  await deps.logger?.info("supabase tool completed", {
    tool: toolName,
    duration_ms: Date.now() - startedAt,
  });

  return JSON.stringify(await response.json(), null, 2);
}

async function executeSupabaseGet(
  input: SupabaseToolInput,
  options: PluginOptions | undefined,
  deps: ToolDeps,
  toolName: string,
  context: SupabaseToolContext,
  path: string,
  errorLabel: string,
) {
  return executeSupabaseRequest(input, options, deps, toolName, context, path, errorLabel);
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
      deps.logger,
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
        return executeSupabaseGet(
          input,
          options,
          deps,
          "supabase_list_organizations",
          _context,
          "/organizations",
          "list organizations",
        );
      },
    }),
    supabase_list_projects: tool({
      description: "List all Supabase projects for the authenticated user.",
      args: {},
      async execute(_args, _context: SupabaseToolContext) {
        return executeSupabaseGet(
          input,
          options,
          deps,
          "supabase_list_projects",
          _context,
          "/projects",
          "list projects",
        );
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
          "supabase_get_project_api_keys",
          _context,
          `/projects/${args.project_ref}/api-keys`,
          "get API keys",
        );
      },
    }),
    supabase_create_project: tool({
      description: "Create a new Supabase project in an organization.",
      args: {
        organization_id: tool.schema.string().describe("Organization ID to create the project in"),
        name: tool.schema.string().describe("Project name"),
        region: tool.schema.string().describe("Database region").optional(),
        db_pass: tool.schema.string().describe("Database password").optional(),
      },
      async execute(args, _context: SupabaseToolContext) {
        await deps.logger?.debug("supabase tool args prepared", {
          tool: "supabase_create_project",
          args: sanitizeToolArgs("supabase_create_project", args),
        });
        return executeSupabaseRequest(
          input,
          options,
          deps,
          "supabase_create_project",
          _context,
          "/projects",
          "create project",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organization_id: args.organization_id,
              name: args.name,
              region: args.region ?? "us-east-1",
              db_pass: args.db_pass ?? generateRandomString(32),
            }),
          },
        );
      },
    }),
    supabase_login: tool({
      description: "Explain how to connect Supabase in the TUI.",
      args: {},
      async execute(_args, _context: SupabaseToolContext) {
        return "Supabase login must be completed in the TUI. Run /supabase first.";
      },
    }),
  };
}
