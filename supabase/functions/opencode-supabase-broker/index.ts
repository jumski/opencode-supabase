import { handleExchangeRequest, handleRefreshRequest } from "./handlers.ts";
import { createBrokerError, errorResponse } from "./http.ts";
import type { BrokerConfig } from "./types.ts";
import { BrokerConfigError } from "./types.ts";

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const DEFAULT_TOKEN_URL = "https://api.supabase.com/v1/oauth/token";
const DEFAULT_REDIRECT_HOSTS = ["localhost"];
const DEFAULT_REDIRECT_PATHS = ["/auth/callback"];

function readList(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

type EnvLike = (name: string) => string | undefined;

export function buildConfigFromEnv(env: EnvLike): BrokerConfig {
  const clientId = env("OPENCODE_SUPABASE_OAUTH_CLIENT_ID");
  const clientSecret = env("OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET");

  if (!clientId) {
    throw new BrokerConfigError("OPENCODE_SUPABASE_OAUTH_CLIENT_ID is not set");
  }

  if (!clientSecret) {
    throw new BrokerConfigError("OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET is not set");
  }

  return {
    clientId,
    clientSecret,
    tokenUrl: env("OPENCODE_SUPABASE_OAUTH_TOKEN_URL") ?? DEFAULT_TOKEN_URL,
    allowedRedirectHosts: readList(env("OPENCODE_SUPABASE_ALLOWED_REDIRECT_HOSTS"), DEFAULT_REDIRECT_HOSTS),
    allowedRedirectPaths: readList(env("OPENCODE_SUPABASE_ALLOWED_REDIRECT_PATHS"), DEFAULT_REDIRECT_PATHS),
  };
}

export function createReadConfig(env: EnvLike): () => BrokerConfig {
  return () => buildConfigFromEnv(env);
}

type ConfigLoader = () => BrokerConfig;

async function routeRequest(request: Request, config: BrokerConfig, fetchImpl: typeof fetch): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === "POST" && pathname === "/exchange") {
    return handleExchangeRequest(request, config, fetchImpl);
  }

  if (request.method === "POST" && pathname === "/refresh") {
    return handleRefreshRequest(request, config, fetchImpl);
  }

  return errorResponse(createBrokerError(400, "invalid_request", "unsupported path or method"));
}

export async function brokerHandler(
  request: Request,
  loadConfig: ConfigLoader,
  fetchImpl: typeof fetch,
): Promise<Response> {
  try {
    const config = loadConfig();
    return await routeRequest(request, config, fetchImpl);
  } catch (error) {
    if (error instanceof BrokerConfigError) {
      console.error(`[broker config error] ${error.detail}`);
      return errorResponse(createBrokerError(500, "server_error", "broker configuration error"));
    }

    console.error(`[broker internal error] ${error instanceof Error ? error.message : String(error)}`);
    return errorResponse(createBrokerError(500, "server_error", "internal server error"));
  }
}

export async function handleBrokerRequest(request: Request): Promise<Response> {
  try {
    if (typeof Deno === "undefined" || typeof Deno.env === "undefined") {
      throw new BrokerConfigError("Deno.env is not available");
    }
    return await brokerHandler(request, createReadConfig(Deno.env.get.bind(Deno.env)), fetch);
  } catch (error) {
    if (error instanceof BrokerConfigError) {
      return errorResponse(createBrokerError(500, "server_error", "broker configuration error"));
    }
    throw error;
  }
}

if (typeof Deno !== "undefined") {
  Deno.serve((request) => handleBrokerRequest(request));
}
