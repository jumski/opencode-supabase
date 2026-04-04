import type { PluginOptions } from "@opencode-ai/plugin";

import {
  DEFAULT_SUPABASE_API_BASE_URL,
  DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
  DEFAULT_SUPABASE_OAUTH_TOKEN_URL,
} from "./api.ts";
import type { SupabaseEnv, SupabaseSharedConfig } from "./types.ts";

function readStringOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPortOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function requireString(value: string | undefined, key: string) {
  if (!value) {
    throw new Error(`Missing required Supabase config: ${key}`);
  }
  return value;
}

function requirePort(value: number | string | undefined) {
  if (value === undefined) {
    throw new Error("Missing required Supabase config: oauthPort");
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid Supabase config: oauthPort must be a positive integer");
  }

  return parsed;
}

export function readSupabaseConfig(
  options: PluginOptions | undefined,
  env: SupabaseEnv = process.env,
): SupabaseSharedConfig {
  const clientId = requireString(
    readStringOption(options, "clientId") ?? env.SUPABASE_CLIENT_ID,
    "clientId",
  );
  const oauthPort = requirePort(
    readPortOption(options, "oauthPort") ?? env.SUPABASE_OAUTH_PORT,
  );

  return {
    clientId,
    oauthPort,
    authorizeUrl:
      readStringOption(options, "authorizeUrl") ??
      env.SUPABASE_OAUTH_AUTHORIZE_URL ??
      DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
    tokenUrl:
      readStringOption(options, "tokenUrl") ?? env.SUPABASE_OAUTH_TOKEN_URL ?? DEFAULT_SUPABASE_OAUTH_TOKEN_URL,
    apiBaseUrl:
      readStringOption(options, "apiBaseUrl") ?? env.SUPABASE_API_BASE_URL ?? DEFAULT_SUPABASE_API_BASE_URL,
  };
}
