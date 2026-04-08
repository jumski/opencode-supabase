import type { FetchLike, SupabaseTokenResponse } from "./types.ts";

export type BrokerConfig = {
  baseUrl: string;
};

export type ExchangeRequest = {
  code: string;
  code_verifier: string;
  redirect_uri: string;
};

export type RefreshRequest = {
  refresh_token: string;
};

export type BrokerErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "rate_limited"
  | "upstream_error"
  | "server_error";

export type BrokerError = {
  code: BrokerErrorCode;
  message: string;
  status: number;
};

export class BrokerClientError extends Error {
  readonly code: BrokerErrorCode;
  readonly status: number;

  constructor(error: BrokerError) {
    super(error.message);
    this.name = "BrokerClientError";
    this.code = error.code;
    this.status = error.status;
  }
}

function normalizeTokenResponse(payload: unknown): SupabaseTokenResponse {
  if (!payload || typeof payload !== "object") {
    throw new BrokerClientError({
      code: "upstream_error",
      message: "broker returned an invalid token response",
      status: 502,
    });
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.access_token !== "string" || record.access_token.length === 0) {
    throw new BrokerClientError({
      code: "upstream_error",
      message: "broker returned an invalid token response",
      status: 502,
    });
  }

  if (typeof record.refresh_token !== "string" || record.refresh_token.length === 0) {
    throw new BrokerClientError({
      code: "upstream_error",
      message: "broker returned an invalid token response",
      status: 502,
    });
  }

  if (typeof record.expires_in !== "number" || !Number.isFinite(record.expires_in)) {
    throw new BrokerClientError({
      code: "upstream_error",
      message: "broker returned an invalid token response",
      status: 502,
    });
  }

  if (typeof record.token_type !== "string" || record.token_type.length === 0) {
    throw new BrokerClientError({
      code: "upstream_error",
      message: "broker returned an invalid token response",
      status: 502,
    });
  }

  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_in: record.expires_in,
    token_type: record.token_type,
  };
}

async function makeBrokerRequest(
  config: BrokerConfig,
  endpoint: string,
  body: unknown,
  fetchImpl: FetchLike,
): Promise<SupabaseTokenResponse> {
  const url = `${config.baseUrl.replace(/\/$/, "")}${endpoint}`;

  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new BrokerClientError({
      code: "upstream_error",
      message: "broker request failed",
      status: 502,
    });
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new BrokerClientError({
      code: "upstream_error",
      message: "broker returned an invalid response",
      status: 502,
    });
  }

  if (!response.ok) {
    const errorBody = payload as Record<string, unknown> | undefined;
    const error = errorBody?.error as Record<string, unknown> | undefined;

    const code = (error?.code as BrokerErrorCode) || "upstream_error";
    const message = (error?.message as string) || "broker request failed";

    throw new BrokerClientError({
      code,
      message,
      status: response.status,
    });
  }

  return normalizeTokenResponse(payload);
}

export async function exchangeCodeThroughBroker(
  config: BrokerConfig,
  input: ExchangeRequest,
  fetchImpl: FetchLike = fetch,
): Promise<SupabaseTokenResponse> {
  return makeBrokerRequest(
    config,
    "/exchange",
    {
      code: input.code,
      code_verifier: input.code_verifier,
      redirect_uri: input.redirect_uri,
    },
    fetchImpl,
  );
}

export async function refreshTokenThroughBroker(
  config: BrokerConfig,
  input: RefreshRequest,
  fetchImpl: FetchLike = fetch,
): Promise<SupabaseTokenResponse> {
  return makeBrokerRequest(
    config,
    "/refresh",
    {
      refresh_token: input.refresh_token,
    },
    fetchImpl,
  );
}
