# Supabase Connected-State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/supabase` auth preflight so already-connected users see connected or unknown-state dialogs instead of always entering the first-run connect flow.

**Architecture:** Keep auth truth on the server side by extending the Supabase auth provider with an additional indexed OAuth method dedicated to status and disconnect operations, while preserving method `0` for the existing interactive OAuth flow. Update the TUI dialog state machine to call the status method on open, surface `checking_auth` only during refresh, and route `Disconnect`, `Retry`, and `Continue` through explicit dialog states backed by the server helper in `src/server/tools.ts`.

**Tech Stack:** TypeScript, Bun test runner, OpenCode plugin server/TUI APIs, Solid signal state, existing Supabase broker refresh helpers.

---

## File Structure

- Modify: `src/server/tools.ts`
  - add a reusable auth-status evaluator and disconnect helper that share store resolution, refresh, and cleanup behavior with tool auth
- Modify: `src/server/auth.ts`
  - add a second OAuth method for status/disconnect operations without changing method `0`
- Modify: `src/tui/dialog.tsx`
  - add preflight flow, new dialog states, and actions for retry/continue/disconnect
- Modify: `test/server-tools.test.ts`
  - add direct coverage for connected/disconnected/unknown/disconnect helper behavior
- Modify: `test/plugin-exports.test.ts`
  - add TUI coverage for connected-state dialogs and action routing

### Task 1: Add Server-Side Auth Status Helpers

**Files:**
- Modify: `src/server/tools.ts`
- Test: `test/server-tools.test.ts`

- [ ] **Step 1: Write the failing server-helper tests**

Add these tests to `test/server-tools.test.ts` near the existing `ensureSupabaseToolAuth` coverage:

```ts
test("reports connected when saved auth is still fresh", async () => {
  const { input } = await createInput();
  await writeSavedAuth(input, {
    access: "saved-access",
    refresh: "saved-refresh",
    expires: Date.now() + 60_000,
  });

  await expect(getSupabaseAuthStatus(input)).resolves.toEqual({
    status: "connected",
    auth: {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: expect.any(Number),
    },
    checked: false,
  });
});

test("reports unknown when refresh fails for broker availability reasons", async () => {
  const { input } = await createInput();
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
          error: { code: "broker_unavailable", message: "broker unavailable" },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`unexpected url: ${url}`);
  });

  await expect(getSupabaseAuthStatus(input, undefined, { fetch: fetchMock })).resolves.toEqual({
    status: "unknown",
    checked: true,
    message: "Supabase auth refresh failed: broker unavailable",
  });
});

test("disconnect helper clears saved auth and host auth", async () => {
  const { input } = await createInput();
  process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
  await writeSavedAuth(input, {
    access: "saved-access",
    refresh: "saved-refresh",
    expires: Date.now() + 60_000,
  });

  const fetchMock: FetchLike = mock(async (request) => {
    const url = String(request);
    if (url === `http://127.0.0.1:7777/auth/supabase?directory=${encodeURIComponent(input.directory)}`) {
      return new Response(JSON.stringify(true), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`unexpected url: ${url}`);
  });

  await disconnectSupabaseAuth(input, { fetch: fetchMock });

  await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
});
```

- [ ] **Step 2: Run server helper tests to verify they fail**

Run: `bun test test/server-tools.test.ts`
Expected: FAIL with missing exports for `getSupabaseAuthStatus` and `disconnectSupabaseAuth`

- [ ] **Step 3: Implement the shared auth-status and disconnect helpers**

Update `src/server/tools.ts` with these additions near the existing auth helpers:

```ts
export type SupabaseAuthStatus =
  | {
      status: "connected";
      auth: SavedAuth;
      checked: boolean;
    }
  | {
      status: "disconnected";
      checked: boolean;
    }
  | {
      status: "unknown";
      checked: true;
      message: string;
    };

export async function disconnectSupabaseAuth(
  input: SupabaseToolInput,
  deps: Pick<ToolDeps, "fetch"> = {},
) {
  const fetchImpl = deps.fetch ?? fetch;
  await clearSavedAuth(input);
  try {
    await clearHostAuth(input, fetchImpl);
  } catch {}
}

export async function getSupabaseAuthStatus(
  input: SupabaseToolInput,
  options?: PluginOptions,
  deps: ToolDeps = {},
): Promise<SupabaseAuthStatus> {
  const saved = await readSavedAuth(input);
  if (!saved.auth) {
    return { status: "disconnected", checked: false };
  }

  if (!isRefreshNeeded(saved.auth)) {
    return { status: "connected", auth: saved.auth, checked: false };
  }

  try {
    const auth = await ensureSupabaseToolAuth(input, options, deps);
    return { status: "connected", auth, checked: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === NOT_CONNECTED_MESSAGE) {
      return { status: "disconnected", checked: true };
    }
    return { status: "unknown", checked: true, message };
  }
}
```

- [ ] **Step 4: Run server helper tests to verify they pass**

Run: `bun test test/server-tools.test.ts`
Expected: PASS for new helper tests and existing auth-helper coverage

- [ ] **Step 5: Commit the server helper slice**

```bash
git add src/server/tools.ts test/server-tools.test.ts
git commit -m "feat(auth): add connected-state status helper"
```

### Task 2: Expose Status and Disconnect Through the Auth Provider

**Files:**
- Modify: `src/server/auth.ts`
- Test: `test/plugin-exports.test.ts`

- [ ] **Step 1: Write the failing auth-provider method test**

Add a focused test to `test/plugin-exports.test.ts`:

```ts
test("server auth provider exposes connect and status methods", async () => {
  const mod = await import("../src/server/auth.ts");
  const provider = mod.createSupabaseAuth(
    {
      directory: "/tmp/project",
      worktree: "/tmp/project",
    },
    undefined,
    {},
  );

  expect(provider.methods).toHaveLength(2);
  expect(provider.methods[0]).toMatchObject({ type: "oauth", label: "Supabase" });
  expect(provider.methods[1]).toMatchObject({ type: "oauth", label: "Supabase Status" });
});
```

- [ ] **Step 2: Run plugin tests to verify they fail**

Run: `bun test test/plugin-exports.test.ts`
Expected: FAIL because only one auth method exists

- [ ] **Step 3: Add the second provider method backed by the new helpers**

Update `src/server/auth.ts` imports and `methods` array to include a status/disconnect method:

```ts
import { disconnectSupabaseAuth, getSupabaseAuthStatus } from "./tools.ts";
```

```ts
      {
        type: "oauth" as const,
        label: "Supabase Status",
        async authorize() {
          return {
            url: "about:blank",
            instructions: "Check Supabase auth status.",
            method: "manual" as const,
            callback: async () => {
              const status = await getSupabaseAuthStatus({
                ...input,
                client: {
                  auth: {
                    set: async () => true,
                  },
                },
                serverUrl: new URL("http://127.0.0.1/"),
              } as never, options, deps as never);

              return {
                type: "success" as const,
                access: JSON.stringify(status),
                refresh: "",
                expires: 0,
              };
            },
          };
        },
      },
```

Then refine the method shape so the callback payload cleanly encodes either `status` or `disconnect` operation without starting browser auth.

- [ ] **Step 4: Run plugin tests to verify they pass**

Run: `bun test test/plugin-exports.test.ts`
Expected: PASS for provider method count and no regression in existing dialog tests

- [ ] **Step 5: Commit the provider bridge slice**

```bash
git add src/server/auth.ts test/plugin-exports.test.ts
git commit -m "feat(auth): expose status bridge to tui"
```

### Task 3: Add TUI Preflight States and Actions

**Files:**
- Modify: `src/tui/dialog.tsx`
- Test: `test/plugin-exports.test.ts`

- [ ] **Step 1: Write the failing TUI dialog tests**

Add these tests to `test/plugin-exports.test.ts` using the existing `createDialogApi` helper:

```ts
test("supabase dialog shows already connected when status check returns connected", async () => {
  const api = createDialogApi({
    client: {
      app: { log: (_input: unknown) => Promise.resolve(true) },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: ({ method }: { method: number }) => {
            if (method === 1) {
              return Promise.resolve({ data: { url: "about:blank", instructions: "status", method: "manual" } });
            }
            return Promise.resolve({ data: { url: "https://example.com/auth", instructions: "oauth", method: "manual" } });
          },
          callback: ({ method }: { method: number }) => {
            if (method === 1) {
              return Promise.resolve({ data: JSON.stringify({ status: "connected", checked: false }) });
            }
            return Promise.resolve({ data: true });
          },
        },
      },
    },
  });

  SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "checking_auth" },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const dialog = api.__test.dialogConfirms.at(-1) as { title?: string; message?: string };
  expect(dialog.title).toBe("Already connected to Supabase");
});
```

Also add cases for:

- showing `Checking Supabase connection...` while status callback is pending and requires refresh
- showing the existing connect dialog when status returns `disconnected`
- showing the unknown-state dialog when status returns `unknown`
- `Disconnect` clearing auth through method `1`
- `Retry` rerunning the preflight from `unknown`

- [ ] **Step 2: Run plugin dialog tests to verify they fail**

Run: `bun test test/plugin-exports.test.ts`
Expected: FAIL because `checking_auth`, `already_connected`, and `unknown_auth` do not exist yet

- [ ] **Step 3: Implement the dialog preflight and actions**

Update `src/tui/dialog.tsx` to:

```ts
type OAuthState =
  | { type: "checking_auth" }
  | { type: "idle" }
  | { type: "already_connected" }
  | { type: "unknown_auth"; message: string }
  | { type: "authorizing"; url: string }
  | { type: "waiting_callback"; url: string }
  | { type: "success" }
  | { type: "error"; message: string; url?: string };
```

Add helpers for the status bridge and disconnect action:

```ts
async function runStatusCheck(api: TuiPluginApi) {
  const authResponse = await api.client.provider.oauth.authorize({
    providerID: "supabase",
    method: 1,
  });
  if (authResponse.error) throw authResponse.error;

  const callbackResponse = await api.client.provider.oauth.callback({
    providerID: "supabase",
    method: 1,
  });
  if (callbackResponse.error) throw callbackResponse.error;

  return JSON.parse(String(callbackResponse.data)) as {
    status: "connected" | "disconnected" | "unknown";
    checked: boolean;
    message?: string;
  };
}
```

Then:

- run preflight on open when initial state is absent
- show `checking_auth` only after a status result indicates `checked: true` or while the callback is pending
- map status results to `already_connected`, `idle`, or `unknown_auth`
- wire `Disconnect` to the method `1` bridge and return to `idle`
- keep existing OAuth success and retry behavior unchanged for method `0`

- [ ] **Step 4: Run plugin dialog tests to verify they pass**

Run: `bun test test/plugin-exports.test.ts`
Expected: PASS for new connected-state dialog coverage and existing OAuth dialog coverage

- [ ] **Step 5: Commit the TUI slice**

```bash
git add src/tui/dialog.tsx test/plugin-exports.test.ts
git commit -m "feat(tui): add supabase auth preflight dialogs"
```

### Task 4: Final Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-04-24-supabase-connected-state.md`

- [ ] **Step 1: Run focused tests together**

Run: `bun test test/server-tools.test.ts test/plugin-exports.test.ts`
Expected: PASS

- [ ] **Step 2: Run full repo verification**

Run: `bun test && bunx tsc --noEmit && biome check .`
Expected: PASS with zero test failures, zero type errors, zero Biome errors

- [ ] **Step 3: Update this plan checklist as tasks complete**

Mark completed checkboxes in this file as you execute the work.

- [ ] **Step 4: Commit the final implementation**

```bash
git add src/server/auth.ts src/server/tools.ts src/tui/dialog.tsx test/server-tools.test.ts test/plugin-exports.test.ts docs/superpowers/plans/2026-04-24-supabase-connected-state.md
git commit -m "feat: add supabase connected-state preflight"
```
