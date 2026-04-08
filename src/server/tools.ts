import type { PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

import {
  BrokerClientError,
  refreshTokenThroughBroker,
} from "../shared/broker.ts";
import { supabaseManagementApiFetch } from "../shared/api.ts";
import { readSupabaseConfig } from "../shared/cfg.ts";
import type { FetchLike } from "../shared/types.ts";
import { readSavedAuth, writeSavedAuth, type SavedAuth } from "./store.ts";

type ToolDeps = {
  fetch?: FetchLike;
};

function isExpired(auth: SavedAuth) {
  return auth.expires <= Date.now();
}

export async function ensureSupabaseToolAuth(
  input: Pick<PluginInput, "directory" | "worktree">,
  options?: PluginOptions,
  deps: ToolDeps = {},
): Promise<SavedAuth> {
  const saved = await readSavedAuth(input);
  if (!saved.auth) {
    throw new Error("No saved Supabase auth found. Please run /supabase first.");
  }

  if (!isExpired(saved.auth)) {
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
    return nextAuth;
  } catch (error) {
    if (error instanceof BrokerClientError) {
      throw new Error(`Supabase auth refresh failed: ${error.message}`);
    }
    throw error;
  }
}

export function createSupabaseTools(
  input: Pick<PluginInput, "directory" | "worktree">,
  options?: PluginOptions,
  deps: ToolDeps = {},
) {
  return {
    supabase_list_projects: tool({
      description: "List all Supabase projects for the authenticated user.",
      args: {},
      async execute() {
        const config = readSupabaseConfig(options);
        const auth = await ensureSupabaseToolAuth(input, options, deps);
        const response = await supabaseManagementApiFetch(
          config,
          auth.access,
          "/projects",
          undefined,
          deps.fetch,
        );

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`Failed to list projects: ${response.status} ${body}`.trim());
        }

        return JSON.stringify(await response.json(), null, 2);
      },
    }),
  };
}
