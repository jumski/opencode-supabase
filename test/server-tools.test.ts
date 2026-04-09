import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createSupabaseTools,
  ensureSupabaseToolAuth,
} from "../src/server/tools.ts";
import { readSavedAuth, writeSavedAuth } from "../src/server/store.ts";
import type { FetchLike } from "../src/shared/types.ts";

type PluginLikeInput = {
  directory: string;
  worktree: string;
};

const cleanupPaths: string[] = [];
const originalBrokerUrl = process.env.OPENCODE_SUPABASE_BROKER_URL;

async function createInput(): Promise<PluginLikeInput> {
  const root = await mkdtemp(join(tmpdir(), "opencode-supabase-tools-"));
  cleanupPaths.push(root);
  return {
    directory: join(root, "consumer"),
    worktree: root,
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
        { fetch: mock(async () => new Response("unexpected")) as never },
      ),
    ).rejects.toThrow("No saved Supabase auth found. Please run /supabase first.");
  });

  test("uses persisted plugin-owned auth for management API requests when access is still valid", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input as never, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock = mock(async (url: string, init?: RequestInit) => {
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
      { fetch: fetchMock as unknown as FetchLike },
    );

    const result = await tools.supabase_list_projects.execute({}, {
      directory: input.directory,
      worktree: input.worktree,
      abort: new AbortController().signal,
      sessionID: "session",
      messageID: "message",
      agent: "agent",
      metadata: () => {},
      ask: async () => {},
    });

    expect(result).toContain("proj_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("refreshes expired persisted auth through the broker before calling the management API", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input as never, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock = mock(async (url: string, init?: RequestInit) => {
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
      { fetch: fetchMock as unknown as FetchLike },
    );

    const result = await tools.supabase_list_projects.execute({}, {
      directory: input.directory,
      worktree: input.worktree,
      abort: new AbortController().signal,
      sessionID: "session",
      messageID: "message",
      agent: "agent",
      metadata: () => {},
      ask: async () => {},
    });

    expect(result).toContain("proj_456");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(readSavedAuth(input as never)).resolves.toMatchObject({
      version: 1,
      auth: {
        access: "fresh-access",
        refresh: "fresh-refresh",
      },
    });
  });
});
