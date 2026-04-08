export type BrokerConfig = {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  allowedRedirectHosts: string[];
  allowedRedirectPaths: string[];
};

export type BrokerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ExchangeRequest = {
  code: string;
  code_verifier: string;
  redirect_uri: string;
};

export type RefreshRequest = {
  refresh_token: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
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
  status: 400 | 401 | 429 | 500 | 502;
};

export type BrokerErrorBody = {
  error: {
    code: BrokerErrorCode;
    message: string;
  };
};

export class BrokerConfigError extends Error {
  readonly #detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "BrokerConfigError";
    this.#detail = detail;
  }

  get detail(): string {
    return this.#detail;
  }
}
