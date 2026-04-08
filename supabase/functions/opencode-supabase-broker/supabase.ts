import { createBrokerError } from "./http.ts";
import type { BrokerConfig, BrokerFetch, TokenResponse } from "./types.ts";

function buildBasicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

function normalizeTokenResponse(payload: unknown): TokenResponse {
  if (!payload || typeof payload !== "object") {
    throw createBrokerError(502, "upstream_error", "upstream returned an invalid token response");
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.access_token !== "string" || record.access_token.length === 0) {
    throw createBrokerError(502, "upstream_error", "upstream returned an invalid token response");
  }

  if (typeof record.refresh_token !== "string" || record.refresh_token.length === 0) {
    throw createBrokerError(502, "upstream_error", "upstream returned an invalid token response");
  }

  if (typeof record.expires_in !== "number" || !Number.isFinite(record.expires_in)) {
    throw createBrokerError(502, "upstream_error", "upstream returned an invalid token response");
  }

  if (typeof record.token_type !== "string" || record.token_type.length === 0) {
    throw createBrokerError(502, "upstream_error", "upstream returned an invalid token response");
  }

  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_in: record.expires_in,
    token_type: record.token_type,
  };
}

async function readUpstreamBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw createBrokerError(502, "upstream_error", "upstream returned an invalid token response");
  }
}

function mapUpstreamStatus(status: number): BrokerConfig extends never ? never : 401 | 502 {
  return status === 400 || status === 401 ? 401 : 502;
}

export async function exchangeAuthorizationCode(
  config: BrokerConfig,
  input: { code: string; codeVerifier: string; redirectUri: string },
  fetchImpl: BrokerFetch,
): Promise<TokenResponse> {
  let response: Response;

  try {
    response = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: buildBasicAuthHeader(config.clientId, config.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }),
    });
  } catch {
    throw createBrokerError(502, "upstream_error", "upstream token request failed");
  }

  const payload = await readUpstreamBody(response);

  if (!response.ok) {
    throw createBrokerError(mapUpstreamStatus(response.status), response.status === 400 || response.status === 401 ? "unauthorized" : "upstream_error", response.status === 400 || response.status === 401 ? "upstream token request was rejected" : "upstream token request failed");
  }

  return normalizeTokenResponse(payload);
}

export async function refreshAccessToken(
  config: BrokerConfig,
  refreshToken: string,
  fetchImpl: BrokerFetch,
): Promise<TokenResponse> {
  let response: Response;

  try {
    response = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: buildBasicAuthHeader(config.clientId, config.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
  } catch {
    throw createBrokerError(502, "upstream_error", "upstream token request failed");
  }

  const payload = await readUpstreamBody(response);

  if (!response.ok) {
    throw createBrokerError(
      response.status === 400 || response.status === 401 ? 401 : 502,
      response.status === 400 || response.status === 401 ? "unauthorized" : "upstream_error",
      response.status === 400 || response.status === 401 ? "upstream token request was rejected" : "upstream token request failed",
    );
  }

  return normalizeTokenResponse(payload);
}
