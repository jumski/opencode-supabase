import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createSupabaseAuth, stopSupabaseAuthServer } from "../src/server/auth.ts";
import { readSavedAuth } from "../src/server/store.ts";
import type { FetchLike } from "../src/shared/types.ts";

const cleanupPaths: string[] = [];

async function createInput() {
  const root = await mkdtemp(join(tmpdir(), "opencode-supabase-auth-"));
  cleanupPaths.push(root);
  return {
    directory: join(root, "consumer"),
    worktree: root,
  };
}

afterEach(async () => {
  await stopSupabaseAuthServer();
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("server auth hook", () => {
  test("builds an auto oauth authorize result using the plugin callback server", async () => {
    const input = await createInput();
    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17654,
      },
      {
        fetch: mock(async () => new Response(JSON.stringify({ access_token: "a", refresh_token: "r" }))) as never,
      },
    );

    const result = await auth.methods[0]?.authorize();
    void result?.callback().catch(() => undefined);

    expect(result?.method).toBe("auto");
    expect(result?.instructions).toContain("browser");

    const url = new URL(String(result?.url));
    expect(url.origin + url.pathname).toBe("https://api.supabase.com/v1/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("plugin-client");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:17654/auth/callback");
    expect(typeof result?.callback).toBe("function");
  });

  test("rejects callback requests with missing state", async () => {
    const input = await createInput();
    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17655,
      },
      {
        fetch: mock(async () => new Response(JSON.stringify({ access_token: "a", refresh_token: "r" }))) as never,
      },
    );

    const result = await auth.methods[0]?.authorize();
    void result?.callback().catch(() => undefined);
    const redirectUri = new URL(new URL(String(result?.url)).searchParams.get("redirect_uri")!);

    const response = await fetch(`${redirectUri.toString()}?code=code-123`);
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("Missing required state parameter");
  });

  test("exchanges the callback code, persists plugin-owned auth, and returns host oauth fields", async () => {
    const input = await createInput();
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_id")).toBe("plugin-client");
      expect(body.get("code")).toBe("code-123");

      return new Response(
        JSON.stringify({
          access_token: "access-123",
          refresh_token: "refresh-123",
          expires_in: 1800,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17656,
      },
      { fetch: fetchMock as unknown as FetchLike },
    );

    const result = await auth.methods[0]!.authorize();
    const authUrl = new URL(result.url);
    const redirectUri = new URL(authUrl.searchParams.get("redirect_uri")!);
    const state = authUrl.searchParams.get("state");

    const pending = result.callback();
    const response = await fetch(`${redirectUri.toString()}?code=code-123&state=${state}`);

    expect(response.status).toBe(200);

    const callbackResult = await pending;
    expect(callbackResult).toMatchObject({
      type: "success",
      access: "access-123",
      refresh: "refresh-123",
    });
    expect(typeof callbackResult.expires).toBe("number");
    expect(callbackResult.expires).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(readSavedAuth(input as never)).resolves.toEqual({
      version: 1,
      auth: {
        access: "access-123",
        refresh: "refresh-123",
        expires: callbackResult.expires,
      },
    });
  });
});
