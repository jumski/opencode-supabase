import { handleExchangeRequest, handleRefreshRequest } from "./handlers.ts";
import { createBrokerError, errorResponse } from "./http.ts";
import type { BrokerConfig } from "./types.ts";

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const DEFAULT_TOKEN_URL = "https://api.supabase.com/v1/oauth/token";
const DEFAULT_REDIRECT_HOSTS = ["127.0.0.1", "localhost"];
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

function readConfig(): BrokerConfig {
  const clientId = Deno.env.get("OPENCODE_SUPABASE_OAUTH_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET") ?? "";

  return {
    clientId,
    clientSecret,
    tokenUrl: Deno.env.get("OPENCODE_SUPABASE_OAUTH_TOKEN_URL") ?? DEFAULT_TOKEN_URL,
    allowedRedirectHosts: readList(
      Deno.env.get("OPENCODE_SUPABASE_ALLOWED_REDIRECT_HOSTS"),
      DEFAULT_REDIRECT_HOSTS,
    ),
    allowedRedirectPaths: readList(
      Deno.env.get("OPENCODE_SUPABASE_ALLOWED_REDIRECT_PATHS"),
      DEFAULT_REDIRECT_PATHS,
    ),
  };
}

async function routeRequest(request: Request, config: BrokerConfig): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === "POST" && pathname === "/exchange") {
    return handleExchangeRequest(request, config, fetch);
  }

  if (request.method === "POST" && pathname === "/refresh") {
    return handleRefreshRequest(request);
  }

  return errorResponse(createBrokerError(400, "invalid_request", "unsupported path or method"));
}

Deno.serve((request) => routeRequest(request, readConfig()));
