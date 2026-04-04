import { describe, expect, mock, test } from "bun:test";

import {
  DEFAULT_SUPABASE_API_BASE_URL,
  DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
  DEFAULT_SUPABASE_OAUTH_TOKEN_URL,
  exchangeCodeForTokens,
  parseTokenResponse,
  refreshAccessToken,
} from "../src/shared/api.ts";
import { readSupabaseConfig } from "../src/shared/cfg.ts";
import { buildAuthorizeUrl } from "../src/shared/oauth.ts";
import type { FetchLike } from "../src/shared/types.ts";

describe("shared config", () => {
  test("reads required values from plugin options and falls back to default endpoints", () => {
    const config = readSupabaseConfig(
      {
        clientId: "plugin-client",
        oauthPort: 1456,
      },
      {},
    );

    expect(config).toEqual({
      clientId: "plugin-client",
      oauthPort: 1456,
      authorizeUrl: DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
      tokenUrl: DEFAULT_SUPABASE_OAUTH_TOKEN_URL,
      apiBaseUrl: DEFAULT_SUPABASE_API_BASE_URL,
    });
  });

  test("reads values from env when plugin options are absent", () => {
    const config = readSupabaseConfig(undefined, {
      SUPABASE_CLIENT_ID: "env-client",
      SUPABASE_OAUTH_PORT: "4567",
      SUPABASE_OAUTH_AUTHORIZE_URL: "https://example.com/authorize",
      SUPABASE_OAUTH_TOKEN_URL: "https://example.com/token",
      SUPABASE_API_BASE_URL: "https://example.com/api",
    });

    expect(config).toEqual({
      clientId: "env-client",
      oauthPort: 4567,
      authorizeUrl: "https://example.com/authorize",
      tokenUrl: "https://example.com/token",
      apiBaseUrl: "https://example.com/api",
    });
  });

  test("fails fast when client id is missing", () => {
    expect(() =>
      readSupabaseConfig(
        {
          oauthPort: 1456,
        },
        {},
      ),
    ).toThrow("Missing required Supabase config: clientId");
  });

  test("fails fast when oauth port is missing or invalid", () => {
    expect(() =>
      readSupabaseConfig(
        {
          clientId: "plugin-client",
        },
        {},
      ),
    ).toThrow("Missing required Supabase config: oauthPort");

    expect(() =>
      readSupabaseConfig(undefined, {
        SUPABASE_CLIENT_ID: "env-client",
        SUPABASE_OAUTH_PORT: "abc",
      }),
    ).toThrow("Invalid Supabase config: oauthPort must be a positive integer");
  });
});

describe("shared oauth", () => {
  test("builds a config-driven authorize url for PKCE", () => {
    const url = buildAuthorizeUrl(
      {
        clientId: "plugin-client",
        authorizeUrl: "https://example.com/oauth/authorize",
      },
      "http://127.0.0.1:1456/callback",
      { verifier: "verifier", challenge: "challenge" },
      "state-123",
    );

    expect(url).toBe(
      "https://example.com/oauth/authorize?response_type=code&client_id=plugin-client&redirect_uri=http%3A%2F%2F127.0.0.1%3A1456%2Fcallback&code_challenge=challenge&code_challenge_method=S256&state=state-123",
    );
  });
});

describe("shared api", () => {
  test("parses token responses and keeps optional fields", () => {
    expect(
      parseTokenResponse({
        access_token: "access",
        refresh_token: "refresh",
        token_type: "bearer",
        expires_in: 3600,
      }),
    ).toEqual({
      access_token: "access",
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: 3600,
    });
  });

  test("rejects invalid token responses", () => {
    expect(() => parseTokenResponse({ refresh_token: "refresh" })).toThrow(
      "Invalid token response: missing access_token",
    );
  });

  test("exchanges codes with a public PKCE request payload", async () => {
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://example.com/oauth/token");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      });

      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_id")).toBe("plugin-client");
      expect(body.get("code")).toBe("code-123");
      expect(body.get("redirect_uri")).toBe("http://127.0.0.1:1456/callback");
      expect(body.get("code_verifier")).toBe("verifier-123");

      return new Response(
        JSON.stringify({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const tokens = await exchangeCodeForTokens(
      {
        clientId: "plugin-client",
        tokenUrl: "https://example.com/oauth/token",
      },
      {
        code: "code-123",
        redirectUri: "http://127.0.0.1:1456/callback",
        codeVerifier: "verifier-123",
      },
      fetchMock as unknown as FetchLike,
    );

    expect(tokens.access_token).toBe("access");
    expect(tokens.refresh_token).toBe("refresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("refreshes tokens with client_id and no client_secret", async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("client_id")).toBe("plugin-client");
      expect(body.get("refresh_token")).toBe("refresh-123");
      expect(String(init?.headers)).not.toContain("Authorization");

      return new Response(
        JSON.stringify({
          access_token: "next-access",
          refresh_token: "next-refresh",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const tokens = await refreshAccessToken(
      {
        clientId: "plugin-client",
        tokenUrl: "https://example.com/oauth/token",
      },
      "refresh-123",
      fetchMock as unknown as FetchLike,
    );

    expect(tokens).toEqual({
      access_token: "next-access",
      refresh_token: "next-refresh",
      expires_in: undefined,
      token_type: undefined,
      id_token: undefined,
      scope: undefined,
    });
  });
});
