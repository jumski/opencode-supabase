import type { FetchLike, SupabaseSharedConfig, SupabaseTokenResponse, TokenExchangeInput } from "./types.ts";

export const DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL = "https://api.supabase.com/v1/oauth/authorize";
export const DEFAULT_SUPABASE_OAUTH_TOKEN_URL = "https://api.supabase.com/v1/oauth/token";
export const DEFAULT_SUPABASE_API_BASE_URL = "https://api.supabase.com/v1";

export function parseTokenResponse(data: unknown): SupabaseTokenResponse {
  const record = data as Record<string, unknown>;
  if (typeof record.access_token !== "string") {
    throw new Error("Invalid token response: missing access_token");
  }
  if (typeof record.refresh_token !== "string") {
    throw new Error("Invalid token response: missing refresh_token");
  }

  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_in: typeof record.expires_in === "number" ? record.expires_in : undefined,
    token_type: typeof record.token_type === "string" ? record.token_type : undefined,
    id_token: typeof record.id_token === "string" ? record.id_token : undefined,
    scope: typeof record.scope === "string" ? record.scope : undefined,
  };
}

async function requestTokens(
  config: Pick<SupabaseSharedConfig, "clientId" | "tokenUrl">,
  params: URLSearchParams,
  fetchImpl: FetchLike = fetch,
): Promise<SupabaseTokenResponse> {
  params.set("client_id", config.clientId);

  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase token request failed: ${response.status} ${text}`.trim());
  }

  return parseTokenResponse(await response.json());
}

export function exchangeCodeForTokens(
  config: Pick<SupabaseSharedConfig, "clientId" | "tokenUrl">,
  input: TokenExchangeInput,
  fetchImpl: FetchLike = fetch,
) {
  return requestTokens(
    config,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
    fetchImpl,
  );
}

export function refreshAccessToken(
  config: Pick<SupabaseSharedConfig, "clientId" | "tokenUrl">,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
) {
  return requestTokens(
    config,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    fetchImpl,
  );
}
