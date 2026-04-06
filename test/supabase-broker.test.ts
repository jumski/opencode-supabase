import { describe, expect, mock, test } from "bun:test";

import { handleExchangeRequest, handleRefreshRequest } from "../supabase/functions/opencode-supabase-broker/handlers.ts";
import type { BrokerConfig, TokenResponse } from "../supabase/functions/opencode-supabase-broker/types.ts";

const baseConfig: BrokerConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  tokenUrl: "https://api.supabase.com/v1/oauth/token",
  allowedRedirectHosts: ["127.0.0.1", "localhost"],
  allowedRedirectPaths: ["/auth/callback"],
};

describe("supabase broker exchange", () => {
  test("rejects malformed exchange json with a normalized 400 response", async () => {
    const response = await handleExchangeRequest(
      new Request("http://127.0.0.1:54321/exchange", {
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
      new Request("http://127.0.0.1:54321/exchange", {
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
      expect(body.get("redirect_uri")).toBe("http://127.0.0.1:14589/auth/callback");

      const payload: TokenResponse = {
        access_token: "access-123",
        refresh_token: "refresh-123",
        expires_in: 3600,
        token_type: "bearer",
      };

      return Response.json(payload, { status: 200 });
    });

    const response = await handleExchangeRequest(
      new Request("http://127.0.0.1:54321/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "code-123",
          code_verifier: "verifier-123",
          redirect_uri: "http://127.0.0.1:14589/auth/callback",
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
});

describe("supabase broker refresh", () => {
  test("rejects malformed refresh payloads with normalized 400 json", async () => {
    const response = await handleRefreshRequest(
      new Request("http://127.0.0.1:54321/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "" }),
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
});
