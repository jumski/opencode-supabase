import {
  createBrokerError,
  errorResponse,
  isBrokerError,
  jsonResponse,
  parseJsonObject,
  requireMethod,
  requireNoExtraFields,
  requireNonEmptyString,
} from "./http.ts";
import { exchangeAuthorizationCode, refreshAccessToken } from "./supabase.ts";
import type { BrokerConfig, BrokerFetch, ExchangeRequest, RefreshRequest } from "./types.ts";

function validateRedirectUri(config: BrokerConfig, redirectUri: string): string {
  let url: URL;

  try {
    url = new URL(redirectUri);
  } catch {
    throw createBrokerError(400, "invalid_request", "redirect_uri must use the local plugin callback pattern");
  }

  if (
    url.protocol !== "http:" ||
    !config.allowedRedirectHosts.includes(url.hostname) ||
    !config.allowedRedirectPaths.includes(url.pathname)
  ) {
    throw createBrokerError(400, "invalid_request", "redirect_uri must use the local plugin callback pattern");
  }

  return url.toString();
}

function parseExchangeRequest(body: Record<string, unknown>, config: BrokerConfig): ExchangeRequest {
  requireNoExtraFields(body, ["code", "code_verifier", "redirect_uri"]);

  return {
    code: requireNonEmptyString(body, "code"),
    code_verifier: requireNonEmptyString(body, "code_verifier"),
    redirect_uri: validateRedirectUri(config, requireNonEmptyString(body, "redirect_uri")),
  };
}

export async function handleExchangeRequest(
  request: Request,
  config: BrokerConfig,
  fetchImpl: BrokerFetch,
): Promise<Response> {
  try {
    requireMethod(request, "POST");

    const body = await parseJsonObject(request);
    const input = parseExchangeRequest(body, config);
    const tokens = await exchangeAuthorizationCode(
      config,
      {
        code: input.code,
        codeVerifier: input.code_verifier,
        redirectUri: input.redirect_uri,
      },
      fetchImpl,
    );

    return jsonResponse(tokens);
  } catch (error) {
    if (isBrokerError(error)) {
      return errorResponse(error);
    }

    return errorResponse(createBrokerError(502, "upstream_error", "upstream token request failed"));
  }
}

function parseRefreshRequest(body: Record<string, unknown>): RefreshRequest {
  requireNoExtraFields(body, ["refresh_token"]);

  return {
    refresh_token: requireNonEmptyString(body, "refresh_token"),
  };
}

export async function handleRefreshRequest(
  request: Request,
  config: BrokerConfig,
  fetchImpl: BrokerFetch,
): Promise<Response> {
  try {
    requireMethod(request, "POST");
    const { refresh_token } = parseRefreshRequest(await parseJsonObject(request));
    const tokens = await refreshAccessToken(config, refresh_token, fetchImpl);
    return jsonResponse(tokens);
  } catch (error) {
    if (isBrokerError(error)) {
      return errorResponse(error);
    }

    return errorResponse(createBrokerError(502, "upstream_error", "upstream token request failed"));
  }
}
