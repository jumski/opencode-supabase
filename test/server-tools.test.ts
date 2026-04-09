import type { ToolContext } from "@opencode-ai/plugin/tool";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createSupabaseTools,
  ensureSupabaseToolAuth,
  type SupabaseToolInput,
} from "../src/server/tools.ts";
import { readSavedAuth, writeSavedAuth } from "../src/server/store.ts";
import type { FetchLike } from "../src/shared/types.ts";

type TestPluginInput = SupabaseToolInput;

type TestToolContext = Pick<
  ToolContext,
  "directory" | "worktree" | "abort" | "sessionID" | "messageID" | "agent" | "metadata" | "ask"
>;

const cleanupPaths: string[] = [];
const originalBrokerUrl = process.env.OPENCODE_SUPABASE_BROKER_URL;

async function createInput(): Promise<TestPluginInput> {
  const root = await mkdtemp(join(tmpdir(), "opencode-supabase-tools-"));
  cleanupPaths.push(root);
  const input = {
    client: {
      auth: {
        set: mock(async () => ({ data: true })),
      },
    },
    directory: join(root, "consumer"),
    worktree: root,
    serverUrl: new URL("http://127.0.0.1:7777/"),
  } satisfies TestPluginInput;

  return input;
}

function createContext(input: TestPluginInput): TestToolContext {
  return {
    directory: input.directory,
    worktree: input.worktree,
    abort: new AbortController().signal,
    sessionID: "session",
    messageID: "message",
    agent: "agent",
    metadata: () => {},
    ask: async () => {},
  };
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  if (originalBrokerUrl === undefined) {
    delete process.env.OPENCODE_SUPABASE_BROKER_URL;
  } else {
    process.env.OPENCODE_SUPABASE_BROKER_URL = originalBrokerUrl;
  }
});

describe("server tools auth helper", () => {
  test("fails clearly when no persisted Supabase auth exists", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";

    await expect(
      ensureSupabaseToolAuth(
        input,
        {
          clientId: "plugin-client",
          oauthPort: 17670,
        },
        { fetch: mock(async () => new Response("unexpected")) },
      ),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");
  });

  test("updates host auth after a successful refresh", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            token_type: "bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify([{ id: "proj_789" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17673,
      },
      { fetch: fetchMock },
    );

    await tools.supabase_list_projects.execute({}, createContext(input));

    expect(input.client.auth.set).toHaveBeenCalledTimes(1);
  });

  test("clears saved auth and host auth when refresh is unauthorized", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "bad-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            error: {
              code: "unauthorized",
              message: "refresh token invalid",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === "http://127.0.0.1:7777/auth/supabase?directory=" + encodeURIComponent(input.directory)) {
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    await expect(
      ensureSupabaseToolAuth(
        input,
        {
          clientId: "plugin-client",
          oauthPort: 17674,
        },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
  });

  test("uses persisted plugin-owned auth for management API requests when access is still valid", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer saved-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ id: "proj_123", name: "Example" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17671,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(input));

    expect(result).toContain("proj_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("refreshes expired persisted auth through the broker before calling the management API", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          refresh_token: "saved-refresh",
        });

        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            token_type: "bearer",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer fresh-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ id: "proj_456" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17672,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(input));

    expect(result).toContain("proj_456");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(input.client.auth.set).toHaveBeenCalledTimes(1);
    await expect(readSavedAuth(input)).resolves.toMatchObject({
      version: 1,
      auth: {
        access: "fresh-access",
        refresh: "fresh-refresh",
      },
    });
  });

  test("lists organizations for the authenticated user", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://api.supabase.com/v1/organizations");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer saved-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ id: "org_123", name: "Acme" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17675,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_organizations.execute({}, createContext(input));

    expect(result).toContain("org_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("formats organization API failures clearly", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async () => {
      return new Response("nope", { status: 403 });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17676,
      },
      { fetch: fetchMock },
    );

    await expect(
      tools.supabase_list_organizations.execute({}, createContext(input)),
    ).rejects.toThrow("Failed to list organizations: 403 nope");
  });

  test("fetches project api keys for a project ref", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://api.supabase.com/v1/projects/proj_123/api-keys");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer saved-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ api_key: "anon-key" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17677,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_get_project_api_keys.execute(
      { project_ref: "proj_123" },
      createContext(input),
    );

    expect(result).toContain("anon-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("formats project api key failures clearly", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async () => {
      return new Response("missing", { status: 404 });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17678,
      },
      { fetch: fetchMock },
    );

    await expect(
      tools.supabase_get_project_api_keys.execute({ project_ref: "proj_404" }, createContext(input)),
    ).rejects.toThrow("Failed to get API keys: 404 missing");
  });
});
