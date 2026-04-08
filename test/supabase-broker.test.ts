import { describe, expect, mock, test } from "bun:test";

import { buildConfigFromEnv, brokerHandler, handleBrokerRequest } from "../supabase/functions/opencode-supabase-broker/index.ts";
import { handleExchangeRequest, handleRefreshRequest } from "../supabase/functions/opencode-supabase-broker/handlers.ts";
import { BrokerConfigError } from "../supabase/functions/opencode-supabase-broker/types.ts";
import type { BrokerConfig, TokenResponse } from "../supabase/functions/opencode-supabase-broker/types.ts";

const baseConfig: BrokerConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  tokenUrl: "https://api.supabase.com/v1/oauth/token",
  allowedRedirectHosts: ["localhost"],
  allowedRedirectPaths: ["/auth/callback"],
};

describe("supabase broker exchange", () => {
  test("rejects malformed exchange json with a normalized 400 response", async () => {
    const response = await handleExchangeRequest(
      new Request("http://localhost:54321/exchange", {
        method: "POST",
        body: "{",
        headers: { "Content-Type": "application/json" },
      }),
      baseConfig,
      mock(async () => {
        throw new Error("fetch should not run for malformed input");
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "request body must be valid JSON",
      },
    });
  });

  test("rejects disallowed redirect uris before calling Supabase", async () => {
    const fetchMock = mock(async () => {
      throw new Error("fetch should not run for rejected redirect_uri");
    });

    const response = await handleExchangeRequest(
      new Request("http://localhost:54321/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "code-123",
          code_verifier: "verifier-123",
          redirect_uri: "https://example.com/auth/callback",
        }),
      }),
      baseConfig,
      fetchMock,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "redirect_uri must use the local plugin callback pattern",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("exchanges a valid authorization code and returns normalized token json", async () => {
    const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.supabase.com/v1/oauth/token");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        Authorization: "Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      });

      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("code-123");
      expect(body.get("code_verifier")).toBe("verifier-123");
      expect(body.get("redirect_uri")).toBe("http://localhost:14589/auth/callback");

      const payload: TokenResponse = {
        access_token: "access-123",
        refresh_token: "refresh-123",
        expires_in: 3600,
        token_type: "bearer",
      };

      return Response.json(payload, { status: 200 });
    });

    const response = await handleExchangeRequest(
      new Request("http://localhost:54321/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "code-123",
          code_verifier: "verifier-123",
          redirect_uri: "http://localhost:14589/auth/callback",
        }),
      }),
      baseConfig,
      fetchMock,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      access_token: "access-123",
      refresh_token: "refresh-123",
      expires_in: 3600,
      token_type: "bearer",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("routes function-prefixed exchange paths used by Supabase local serve", async () => {
    const fetchMock = mock(async () => {
      return Response.json(
        {
          access_token: "access-prefixed",
          refresh_token: "refresh-prefixed",
          expires_in: 3600,
          token_type: "bearer",
        },
        { status: 200 },
      );
    });

    const response = await brokerHandler(
      new Request("http://localhost:54321/opencode-supabase-broker/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "code-prefixed",
          code_verifier: "verifier-prefixed",
          redirect_uri: "http://localhost:14589/auth/callback",
        }),
      }),
      () => baseConfig,
      fetchMock as unknown as typeof fetch,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      access_token: "access-prefixed",
      refresh_token: "refresh-prefixed",
      expires_in: 3600,
      token_type: "bearer",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("supabase broker refresh", () => {
  test("rejects malformed refresh payloads with normalized 400 json", async () => {
    const response = await handleRefreshRequest(
      new Request("http://localhost:54321/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "" }),
      }),
      baseConfig,
      mock(async () => {
        throw new Error("fetch should not run for validation failures");
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "refresh_token must be a non-empty string",
      },
    });
  });

  test("refreshes an expired token and returns normalized token json", async () => {
    const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.supabase.com/v1/oauth/token");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        Authorization: "Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      });

      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("refresh-abc");

      return Response.json(
        { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, token_type: "bearer" },
        { status: 200 },
      );
    });

    const response = await handleRefreshRequest(
      new Request("http://localhost:54321/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh-abc" }),
      }),
      baseConfig,
      fetchMock,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      token_type: "bearer",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("normalizes upstream auth rejection to 401 json", async () => {
    const fetchMock = mock(async () => {
      return Response.json({ error: "invalid_grant" }, { status: 401 });
    });

    const response = await handleRefreshRequest(
      new Request("http://localhost:54321/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "revoked-token" }),
      }),
      baseConfig,
      fetchMock,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "upstream token request was rejected",
      },
    });
  });

  test("normalizes malformed upstream success payload to 502 json", async () => {
    const fetchMock = mock(async () => {
      return Response.json({ access_token: "", refresh_token: "ok", expires_in: 3600, token_type: "bearer" }, { status: 200 });
    });

    const response = await handleRefreshRequest(
      new Request("http://localhost:54321/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "valid-but-bad-response" }),
      }),
      baseConfig,
      fetchMock,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "upstream_error",
        message: "upstream returned an invalid token response",
      },
    });
  });
});

describe("broker config", () => {
  test("throws BrokerConfigError when client_id is missing", () => {
    expect(() => buildConfigFromEnv(() => undefined)).toThrow(BrokerConfigError);
  });

  test("throws BrokerConfigError when client_secret is missing", () => {
    expect(() =>
      buildConfigFromEnv((name) =>
        name === "OPENCODE_SUPABASE_OAUTH_CLIENT_ID" ? "some-id" : undefined
      ),
    ).toThrow(BrokerConfigError);
  });

  test("uses defaults for optional config when env returns undefined", () => {
    const config = buildConfigFromEnv((name) => {
      if (name === "OPENCODE_SUPABASE_OAUTH_CLIENT_ID") return "my-client";
      if (name === "OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET") return "my-secret";
      return undefined;
    });

    expect(config.tokenUrl).toBe("https://api.supabase.com/v1/oauth/token");
    expect(config.allowedRedirectHosts).toEqual(["localhost"]);
    expect(config.allowedRedirectPaths).toEqual(["/auth/callback"]);
  });

  test("overrides optional config from env", () => {
    const config = buildConfigFromEnv((name) => {
      if (name === "OPENCODE_SUPABASE_OAUTH_CLIENT_ID") return "my-client";
      if (name === "OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET") return "my-secret";
      if (name === "OPENCODE_SUPABASE_OAUTH_TOKEN_URL") return "https://custom.example.com/token";
      if (name === "OPENCODE_SUPABASE_ALLOWED_REDIRECT_HOSTS") return "example.com";
      if (name === "OPENCODE_SUPABASE_ALLOWED_REDIRECT_PATHS") return "/custom/callback";
      return undefined;
    });

    expect(config.tokenUrl).toBe("https://custom.example.com/token");
    expect(config.allowedRedirectHosts).toEqual(["example.com"]);
    expect(config.allowedRedirectPaths).toEqual(["/custom/callback"]);
  });
});

describe("broker edge handler config failures", () => {
  test("returns generic 500 json when client_id is missing", async () => {
    const response = await handleBrokerRequest(
      new Request("http://localhost:54321/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "x", code_verifier: "y", redirect_uri: "http://localhost:14589/auth/callback" }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "server_error",
        message: "broker configuration error",
      },
    });
  });

  test("returns generic 500 json when client_secret is missing", async () => {
    const response = await handleBrokerRequest(
      new Request("http://localhost:54321/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "some-token" }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "server_error",
        message: "broker configuration error",
      },
    });
  });

  test("response body does not leak env var names or secret details", async () => {
    const response = await handleBrokerRequest(
      new Request("http://localhost:54321/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "x", code_verifier: "y", redirect_uri: "http://localhost:14589/auth/callback" }),
      }),
    );

    const body = await response.text();
    expect(body).not.toContain("OPENCODE_SUPABASE_OAUTH_CLIENT_ID");
    expect(body).not.toContain("OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET");
    expect(body).not.toContain("client_secret");
    expect(body).not.toContain("undefined");
  });

  test("returns generic internal server error message for non-config failures", async () => {
    const response = await brokerHandler(
      new Request("http://localhost:54321/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "x", code_verifier: "y", redirect_uri: "http://localhost:14589/auth/callback" }),
      }),
      () => {
        throw new Error("unexpected runtime failure");
      },
      fetch,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "server_error",
        message: "internal server error",
      },
    });
  });

  test("returns application/json content-type on 500 responses", async () => {
    const response = await handleBrokerRequest(
      new Request("http://localhost:54321/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "x", code_verifier: "y", redirect_uri: "http://localhost:14589/auth/callback" }),
      }),
    );

    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  test("routes /refresh successfully through handleBrokerRequest with valid config", async () => {
    const fetchMock = mock(async () => {
      return Response.json(
        { access_token: "access-rt", refresh_token: "refresh-rt", expires_in: 3600, token_type: "bearer" },
        { status: 200 },
      );
    });

    const response = await brokerHandler(
      new Request("http://localhost:54321/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh-token-rt" }),
      }),
      () => ({ ...baseConfig, fetch: fetchMock as never }),
      fetchMock as unknown as typeof fetch,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      access_token: "access-rt",
      refresh_token: "refresh-rt",
      expires_in: 3600,
      token_type: "bearer",
    });
  });
});
