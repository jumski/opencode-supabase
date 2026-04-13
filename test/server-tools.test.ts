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
import { createSupabaseLogger } from "../src/shared/log.ts";
import type { FetchLike } from "../src/shared/types.ts";

type TestPluginInput = SupabaseToolInput;

type HostAuthSetMock = ReturnType<typeof mock>;

type TestFixtures = {
  hostAuthSet: HostAuthSetMock;
  input: TestPluginInput;
};

type TestToolContext = Pick<
  ToolContext,
  "directory" | "worktree" | "abort" | "sessionID" | "messageID" | "agent" | "metadata" | "ask"
>;

const cleanupPaths: string[] = [];
const originalBrokerUrl = process.env.OPENCODE_SUPABASE_BROKER_URL;

async function createInput(): Promise<TestFixtures> {
  const root = await mkdtemp(join(tmpdir(), "opencode-supabase-tools-"));
  cleanupPaths.push(root);
  const hostAuthSet = mock(async () => ({ data: true }));
  const input = {
    client: {
      auth: {
        set: hostAuthSet,
      },
    },
    directory: join(root, "consumer"),
    worktree: root,
    serverUrl: new URL("http://127.0.0.1:7777/"),
  } satisfies TestPluginInput;

  return { hostAuthSet, input };
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
  test("logs tool execution boundaries and redacts sensitive args", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: `access-${Date.now()}`,
      refresh: `refresh-${Date.now()}`,
      expires: Date.now() + 60_000,
    });

    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ id: "project-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const write = mock(async () => true);
    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17671,
      },
      {
        fetch: fetchMock as unknown as FetchLike,
        logger: createSupabaseLogger({ write }),
      },
    );

    await tools.supabase_create_project.execute(
      {
        organization_id: "org-1",
        name: "My Project",
        region: "us-east-1",
        db_pass: "super-secret-db-pass",
      },
      createContext(input),
    );

    const entries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(entries.some((entry) => entry.includes("supabase tool started"))).toBe(true);
    expect(entries.some((entry) => entry.includes("supabase tool completed"))).toBe(true);
    expect(entries.join(" ")).toContain("supabase_create_project");
    expect(entries.join(" ")).not.toContain("super-secret-db-pass");
  });

  test("logs tool auth failures and request failures", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const write = mock(async () => true);
    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17672,
      },
      {
        fetch: mock(async () => new Response("unexpected")) as unknown as FetchLike,
        logger: createSupabaseLogger({ write }),
      },
    );

    await expect(tools.supabase_list_projects.execute({}, createContext(input))).rejects.toThrow(
      "Supabase is not connected. Run /supabase first.",
    );

    const entries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(entries.some((entry) => entry.includes("supabase tool started"))).toBe(true);
    expect(entries.some((entry) => entry.includes("supabase tool failed"))).toBe(true);
  });

  test("does not log tool completion when response json parsing fails", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: `access-${Date.now()}`,
      refresh: `refresh-${Date.now()}`,
      expires: Date.now() + 60_000,
    });

    const write = mock(async () => true);
    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17675,
      },
      {
        fetch: mock(async () =>
          new Response("not-json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as unknown as FetchLike,
        logger: createSupabaseLogger({ write }),
      },
    );

    await expect(tools.supabase_list_projects.execute({}, createContext(input))).rejects.toThrow();

    const entries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(entries.some((entry) => entry.includes("supabase tool completed"))).toBe(false);
    expect(entries.some((entry) => entry.includes("supabase tool failed"))).toBe(true);
  });

  test("fails clearly when no persisted Supabase auth exists", async () => {
    const { input } = await createInput();
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
    const { hostAuthSet, input } = await createInput();
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

    expect(hostAuthSet).toHaveBeenCalledTimes(1);
  });

  test("clears saved auth and host auth when refresh is unauthorized", async () => {
    const { input } = await createInput();
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
    const { input } = await createInput();
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
    const { hostAuthSet, input } = await createInput();
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
    expect(hostAuthSet).toHaveBeenCalledTimes(1);
    await expect(readSavedAuth(input)).resolves.toMatchObject({
      version: 1,
      auth: {
        access: "fresh-access",
        refresh: "fresh-refresh",
      },
    });
  });

  test("refreshes a nearly expired token before calling the management API", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "stale-access",
      refresh: "saved-refresh",
      expires: Date.now() + 5_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
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

      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer fresh-access",
      });

      return new Response(JSON.stringify([{ id: "proj_near" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17679,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(input));

    expect(result).toContain("proj_near");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("continues with refreshed plugin auth when host auth sync fails", async () => {
    const { hostAuthSet, input } = await createInput();
    hostAuthSet.mockImplementationOnce(async () => {
      throw new Error("host auth unavailable");
    });

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

      return new Response(JSON.stringify([{ id: "proj_host_sync" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17680,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(input));

    expect(result).toContain("proj_host_sync");
    await expect(readSavedAuth(input)).resolves.toMatchObject({
      auth: {
        access: "fresh-access",
        refresh: "fresh-refresh",
      },
    });
  });

  test("still returns reconnect guidance when host auth cleanup fails", async () => {
    const { input } = await createInput();
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
        throw new Error("delete failed");
      }

      throw new Error(`unexpected url: ${url}`);
    });

    await expect(
      ensureSupabaseToolAuth(
        input,
        {
          clientId: "plugin-client",
          oauthPort: 17681,
        },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
  });

  test("lists organizations for the authenticated user", async () => {
    const { input } = await createInput();
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
    const { input } = await createInput();
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
    const { input } = await createInput();
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
    const { input } = await createInput();
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

  test("creates a project with default region and generated db password", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer saved-access",
        Accept: "application/json",
        "Content-Type": "application/json",
      });

      const body = JSON.parse(String(init?.body)) as {
        organization_id: string;
        name: string;
        region: string;
        db_pass: string;
      };
      expect(body.organization_id).toBe("org_123");
      expect(body.name).toBe("demo-project");
      expect(body.region).toBe("us-east-1");
      expect(body.db_pass.length).toBeGreaterThanOrEqual(24);

      return new Response(JSON.stringify({ id: "proj_new", name: "demo-project" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17682,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_create_project.execute(
      { organization_id: "org_123", name: "demo-project" },
      createContext(input),
    );

    expect(result).toContain("proj_new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("creates a project with provided region and db password", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (_request, init) => {
      const body = JSON.parse(String(init?.body)) as {
        organization_id: string;
        name: string;
        region: string;
        db_pass: string;
      };
      expect(body).toEqual({
        organization_id: "org_999",
        name: "named-project",
        region: "eu-west-1",
        db_pass: "secret-pass",
      });

      return new Response(JSON.stringify({ id: "proj_custom" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17683,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_create_project.execute(
      {
        organization_id: "org_999",
        name: "named-project",
        region: "eu-west-1",
        db_pass: "secret-pass",
      },
      createContext(input),
    );

    expect(result).toContain("proj_custom");
  });

  test("formats create project failures clearly", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async () => new Response("bad request", { status: 400 }));

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17684,
      },
      { fetch: fetchMock },
    );

    await expect(
      tools.supabase_create_project.execute(
        { organization_id: "org_123", name: "bad-project" },
        createContext(input),
      ),
    ).rejects.toThrow("Failed to create project: 400 bad request");
  });

  test("supabase_login returns TUI guidance", async () => {
    const { input } = await createInput();

    const tools = createSupabaseTools(input, {
      clientId: "plugin-client",
      oauthPort: 17685,
    });

    await expect(tools.supabase_login.execute({}, createContext(input))).resolves.toBe(
      "Supabase login must be completed in the TUI. Run /supabase first.",
    );
  });
});
