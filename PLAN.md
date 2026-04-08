# Supabase External Plugin Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the Supabase prototype into a standalone dual-target plugin package that installs through `opencode plugin` on compatible OpenCode versions, supports manual local-path configuration as a fallback, exposes `/supabase` in the TUI, completes browser OAuth through a stateless token broker, persists auth for later tool use, and provides Supabase Management API tools.

**Architecture:** Ship one npm package with two target-only entrypoints, `./server` and `./tui`, because OpenCode rejects a single module exporting both `server` and `tui`; see `packages/opencode/src/plugin/shared.ts:89` and `packages/opencode/src/plugin/shared.ts:277`. Put shared OAuth and API code under `src/shared`, auth and tool logic under `src/server`, and `/supabase` command and dialog UX under `src/tui`. Persist tokens in plugin-owned storage because external tools do not get host auth-read access; see `packages/plugin/src/tool.ts:3`. The plugin owns the public `client_id`, PKCE generation, `state`, local callback handling, and local token storage. A separate stateless broker owns only confidential token exchange and refresh against `https://api.supabase.com/v1/oauth/token` because Supabase Management API OAuth Apps document `client_secret` usage at the token step.

**Tech Stack:** Bun, TypeScript, `@opencode-ai/plugin`, `@opencode-ai/plugin/tui`, `@opencode-ai/sdk`, `zod`, `open`, Supabase OAuth, Supabase Management API, stateless broker contract, optional Supabase Edge Functions.

---

## Verified constraints from the current OpenCode codebase

- `opencode plugin` and external TUI plugin loading through `.opencode/tui.jsonc` require OpenCode `>= 1.3.4`. OpenCode `1.2.27` rejects the `plugin` key in `tui.jsonc`, so `/supabase` cannot be registered there.
- Manual local-path configuration through `.opencode/opencode.jsonc` and `.opencode/tui.jsonc` remains a supported fallback on compatible OpenCode versions; relative path entries in those files resolve from inside `.opencode/`, not from the consumer repo root; see `packages/opencode/src/config/config.ts:286` and `packages/opencode/src/config/tui.ts:57`.
- The package must expose separate `./server` and `./tui` entrypoints. TUI loading does not fall back to `main` or `exports["."]`; see `packages/opencode/src/plugin/shared.ts:89`.
- `/supabase` should remain a TUI slash command. It can open a dialog through the public TUI plugin API; see `packages/plugin/src/tui.ts:389`.
- The plugin can use the built-in provider OAuth endpoints through `client.provider.oauth.authorize()` and `client.provider.oauth.callback()`; see `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx:83` and `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx:145`.
- Plugin-owned token persistence is required for tool execution because tool handlers receive only `ToolContext`, not host auth readers or a privileged SDK surface; see `packages/plugin/src/tool.ts:3`.
- The browser open step is an explicit plugin responsibility. The built-in provider dialog shows the URL, but does not auto-open the browser by itself. If this plugin wants native-feeling auto-open behavior, it must implement it directly.
- Do not promise concurrent Supabase OAuth attempts for the same provider. Current host pending OAuth state is still keyed by `providerID`; see `packages/opencode/src/provider/auth.ts:184`.

## Verified donor references

- The Supabase prototype donor is present in `/home/jumski/Code/github/opencode/.worktrees/supabase`.
- Primary Supabase donor: `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts` for Supabase-specific OAuth helpers, tools, and auth flow shape.
- Primary TUI donor: `.worktrees/supabase/packages/opencode/src/cli/cmd/tui/component/dialog-supabase.tsx` for the dedicated `/supabase` dialog UX and `.worktrees/supabase/packages/opencode/src/cli/cmd/tui/app.tsx` for slash command wiring.
- Stronger generic OAuth donor: `.worktrees/supabase/packages/opencode/src/plugin/codex.ts` for the local callback server pattern and auth hook shape.
- Stronger public TUI OAuth donor: `.worktrees/supabase/packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx` for the public `provider.oauth.authorize()` plus `provider.oauth.callback()` flow.
- Additional hardening donor: `.worktrees/supabase/packages/opencode/src/mcp/oauth-callback.ts` for state-keyed pending auth management and port-in-use handling.
- Treat all donor line numbers in this plan as starting points, but prefer these verified files over older assumptions when extraction details conflict.

## Superseding auth decision (2026-04-06)

- Supabase's current Management API OAuth App docs continue to show `client_secret` authentication at `POST https://api.supabase.com/v1/oauth/token`.
- That invalidates the earlier assumption that this plugin could complete the documented Management API OAuth flow as a pure public `client_id`-only PKCE client.
- The extracted plugin must not hold or ship `client_secret`.
- Therefore the live auth flow pivots to a stateless broker that holds `client_secret` server-side and exposes only exchange and refresh endpoints.
- The broker contract in `docs/supabase-oauth-broker-contract.md` is the source of truth for that boundary.

## Assumptions

- Keep the provider id as `"supabase"` so the TUI plugin can call `provider.oauth.authorize({ providerID: "supabase", method: 0 })`.
- Keep `/supabase` as a dedicated TUI slash command. Do not add custom server routes or first-class server CLI commands.
- Do not ship hardcoded OAuth client secrets in the plugin. Keep the Supabase OAuth App `client_secret` only in the external broker deployment.
- The plugin should continue to use a public `client_id`, but treat it as an OpenCode-managed public identifier rather than a BYO credential.
- The plugin owns `state`, PKCE `code_verifier`, the local callback server, browser-open behavior, and plugin-owned token persistence.
- The broker stays deliberately dumb and stateless: it exposes only exchange and refresh endpoints, stores no user tokens, and does not own the browser callback.
- Keep `supabase_login` as a fallback tool, but treat `/supabase` as the primary user-facing login flow.

## Architecture fit and tradeoffs

### Why this fits OpenCode well

- Server and TUI are already split responsibilities in the host architecture.
- One npm package with `./server` and `./tui` works with the existing install flow.
- `/supabase` in TUI plus Supabase tools on the server preserves a native-feeling UX without requiring core changes.

### Main disadvantages

- The plugin needs its own token store in addition to normal host provider auth persistence.
- The feature spans two runtimes, so TUI login UX and server-side tool execution must stay coordinated.
- Browser auto-open can fail on some systems, so the dialog needs a visible manual fallback path.
- True concurrent Supabase OAuth flows are out of scope because host pending OAuth state is keyed by provider id.
- Supabase Management API OAuth Apps require a confidential token-exchange step, so turnkey login now depends on a small hosted broker in addition to the plugin package.

### Recommendation

- Follow the external dual-target design.
- Treat plugin-owned token storage as a first-class requirement, not a workaround to add later.
- Keep the broker contract stateless and narrow: no broker-owned callback, no token storage, and no Management API proxy.
- Start with the visible success outcome in TUI and defer any deeper host refresh/bootstrap parity work to later research if the public plugin APIs prove insufficient.
- Deliver the feature in phases so each phase yields a concrete testable milestone.

## Target repo shape

```text
opencode-supabase/
  package.json
  tsconfig.json
  README.md
  src/
    shared/
      cfg.ts
      oauth.ts
      api.ts
      broker.ts
      types.ts
    server/
      index.ts
      auth.ts
      store.ts
      tools.ts
    tui/
      index.tsx
      dialog.tsx
```

## Current bootstrap status

- Destination repo path: `/home/jumski/Code/jumski/opencode-supabase`
- The repo has already been initialized with `git init` and `bun init -y`.
- Current starter files are `.gitignore`, `CLAUDE.md`, `README.md`, `index.ts`, `package.json`, `tsconfig.json`, and `bun.lock`.
- Task 1 should reshape this Bun starter scaffold into the dual-target plugin package rather than assuming a completely blank folder.

## Current progress snapshot (2026-04-06)

- Phase 1 is complete: the package is dual-target, install docs exist, and `/supabase` opens through the TUI plugin.
- Phase 2 happy-path OAuth is complete: `/supabase` opens the browser, the local callback succeeds, the plugin exchanges through the broker, plugin-owned auth is persisted, and OpenCode now shows the success outcome instead of a false denial.
- The reference broker implementation is functionally complete for v1 exchange and refresh, including local Supabase Edge Function serving, request validation, upstream normalization, and local setup docs.
- The active next milestone is Phase 3 / Task 8: implement the first real authenticated Supabase Management API tool and prove restart persistence plus tool-time auth reuse.

### Verified implementation findings that supersede earlier assumptions

- The local plugin callback must use `http://localhost:<port>/auth/callback`, not `127.0.0.1`, because Supabase allows plain HTTP loopback for `localhost` but rejected `127.0.0.1` in real testing.
- Supabase local Edge Function serving passes a function-prefixed path like `/opencode-supabase-broker/exchange`, so broker routing must normalize prefixed paths instead of matching only exact `/exchange` and `/refresh`.
- The TUI-side `provider.oauth.callback(...)` flow must treat callback success according to the real SDK/client contract used at runtime. The implementation now handles the callback acknowledgment path correctly and no longer assumes a fake `{ type: "success" }` response shape from the TUI client surface.
- The broker contract doc and current broker implementation still differ on internal/config failure responses: the implementation returns generic `500 server_error` JSON for those cases, while the contract doc still recommends only `400/401/429/502`. Keep this mismatch visible until reconciled.

### Active focus

- Do not spend more time on happy-path OAuth plumbing unless a new regression appears.
- Prioritize Task 8 next.

## Donor mapping

- `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:21` -> `src/shared/oauth.ts`
- `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:67` -> `src/shared/api.ts`
- `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:87` -> `src/shared/api.ts`
- `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:109` -> `src/shared/api.ts`
- `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:229` -> `src/server/auth.ts`
- `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:308` -> `src/server/auth.ts`
- `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:335` -> `src/server/tools.ts` and `src/server/store.ts`
- `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:369` -> `src/server/index.ts`
- `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:404` -> `src/server/tools.ts`
- `.worktrees/supabase/packages/opencode/src/cli/cmd/tui/component/dialog-supabase.tsx:10` -> `src/tui/dialog.tsx`
- `.worktrees/supabase/packages/opencode/src/cli/cmd/tui/app.tsx:523` -> `src/tui/index.tsx`

## Phased delivery plan (v2, strict)

Execute this plan in phases. Do not start a later phase until the current phase exit criteria are met.

### Cross-phase constraints

- Primary install story for this phase is `opencode plugin ../../opencode-supabase` from a consumer repo on OpenCode `>= 1.3.4`.
- Manual local-path configuration through `.opencode/opencode.jsonc` and `.opencode/tui.jsonc` is the fallback path when CLI install is not desired.
- Manual verification for this phase requires an OpenCode host version with `opencode plugin` and TUI plugin support in `tui.jsonc` (`>= 1.3.4`).
- The package must remain one npm package with separate `./server` and `./tui` entrypoints.
- Keep provider id exactly `supabase`.
- Do not rely on a `client_secret` inside the plugin repo; the live OAuth flow depends on an external broker that holds it server-side.
- Keep the plugin-side OAuth responsibilities local: authorize URL creation, PKCE, `state`, callback handling, and local token persistence.
- From Task 6 onward, end-to-end OAuth verification requires a reachable broker implementation that matches `docs/supabase-oauth-broker-contract.md`.
- Do not add custom HTTP routes.
- Do not try to integrate Supabase into the stock provider picker.
- Browser auto-open is a plugin responsibility. If it fails, the dialog must still show the URL and clear instructions.
- Do not require a full internal TUI sync refresh as a milestone. The required user-facing result is dialog close plus in-app success confirmation plus working tools.
- Treat host-specific refresh/bootstrap parity as follow-up research, not as a prerequisite for the first working external plugin release.
- Only one in-flight Supabase OAuth flow needs to work reliably.

### Phase 1: Install path plus `/supabase` dialog shell

**Goal:** Prove packaging and command registration before implementing OAuth.

**Status:** Completed on 2026-04-06.

**Covers:** Task 1, Task 2, and Task 3.

**Deliverable:**

- CLI installation from a consumer repo works
- manual local-path configuration works as a fallback
- both plugin targets load
- `/supabase` exists and opens a dialog shell
- dialog open and close behavior works cleanly

**Manual verification:**

1. `bun install`
2. `bun run typecheck`
3. In a separate consumer repo on OpenCode `>= 1.3.4`, run `opencode plugin ../../opencode-supabase`
4. Start OpenCode from the consumer repo
5. Run `/supabase`
6. Confirm the dialog opens and closes without loader or runtime errors
7. Confirm both config surfaces were patched by the CLI install
8. Optional fallback verification: configure `../../opencode-supabase` manually in `.opencode/opencode.jsonc` and `.opencode/tui.jsonc`
9. Confirm the same plugin loads through manual config too

**Exit criteria:**

- dual-target package resolution works through CLI install
- both config surfaces load the plugin correctly
- `/supabase` is visible and interactive

**Deferred:** real OAuth, browser open behavior, token persistence, real Supabase API calls

### Phase 2: Browser OAuth happy path

**Goal:** Make `/supabase` perform the real OAuth flow and finish with clear success confirmation.

**Status:** Completed on 2026-04-06.

**Covers:** Task 4, Task 5, Task 6, and Task 7.

**Deliverable:**

- `/supabase` starts the real Supabase OAuth flow
- the plugin attempts to open the default browser
- if browser open fails, the dialog still shows the authorization URL and waiting state
- OAuth callback succeeds
- host auth is persisted through the normal provider callback path
- plugin-owned auth is also persisted for later tool use
- the dialog closes automatically on success
- the user sees a short confirmation message describing next available Supabase actions
- no host-internal refresh/bootstrap hack is required to call the phase complete

**Manual verification:**

1. `bun run typecheck`
2. Install the plugin from a consumer repo using `opencode plugin ../../opencode-supabase`
3. Start OpenCode
4. Run `/supabase`
5. Confirm the plugin attempts to open the browser
6. If the browser does not open automatically, confirm the dialog still exposes the URL and instructions
7. Complete Supabase OAuth in the browser
8. Confirm the dialog closes automatically
9. Confirm the in-app success message appears and mentions next actions
10. Restart OpenCode
11. Confirm `/supabase` no longer behaves like a first-run disconnected shell

**Implementation note:**

- Do not attempt direct token exchange from the plugin against Supabase Management API OAuth endpoints. Task 6 and Task 7 must pivot to the broker contract in `docs/supabase-oauth-broker-contract.md` for exchange and Task 9 must use the same boundary for refresh.
- Real implementation follow-up notes from this phase:
  - the callback host needed to be `localhost`, not `127.0.0.1`
  - the broker needed to accept function-prefixed Edge Function paths during local serve
  - the TUI callback success path needed to match the real runtime callback acknowledgment shape

**Exit criteria:**

- happy-path OAuth works end-to-end
- plugin-owned token store is written
- host provider auth is also persisted
- no custom routes were added

**Deferred:** proving tool-time token reuse, full refresh behavior, full tool surface

### Phase 3: First authenticated Supabase tool

**Goal:** Prove that persisted plugin-owned auth can power one real management tool after restart.

**Status:** Current active milestone.

**Covers:** Task 8.

**Deliverable:**

- one real authenticated tool works end-to-end
- recommended first tool: `supabase_list_projects`
- acceptable simpler fallback: `supabase_list_organizations`

**Manual verification:**

1. Complete Phase 2 login
2. Ask OpenCode to run the chosen first real Supabase tool
3. Confirm it succeeds against the real Supabase Management API
4. Restart OpenCode
5. Run the same tool again
6. Confirm it still works without re-running `/supabase`

**Exit criteria:**

- one real tool works
- restart persistence is proven
- tool-time auth reuse is proven

**Deferred:** remaining tools, broad auth recovery behavior, polish

### Phase 4: Remaining tool surface plus token lifecycle handling

**Goal:** Finish the management tool set and make auth refresh and failure paths reliable.

**Status:** Not started.

**Covers:** Task 9.

**Deliverable:**

- all planned tool ids are implemented
- expired access tokens refresh correctly
- refresh success updates both plugin-owned storage and host auth storage
- refresh failure clears both storage locations and produces a clear reconnect message

**Manual verification:**

1. `bun run typecheck`
2. Run each implemented tool at least once on a real Supabase account
3. Force an expired-access-token scenario
4. Confirm a tool can refresh and continue
5. Force an invalid-refresh-token scenario
6. Confirm saved auth is cleared and the user is told to run `/supabase` again

**Exit criteria:**

- all planned tool ids work
- refresh path is proven
- invalid-auth recovery path is proven

**Deferred:** README polish, prototype cleanup decisions, CI automation

### Phase 5: Docs polish plus prototype retirement decision

**Goal:** Make the plugin easy to install, verify, and hand off.

**Status:** Partially started, but not complete until at least one real tool exists and README verification is re-run end to end.

**Covers:** Task 10.

**Deliverable:**

- README matches the real install and login flow
- README documents local development install
- README documents required config and env values
- prototype cleanup is either deferred explicitly or planned as a separate follow-up

**Manual verification:**

1. Follow the README from scratch in a clean setup
2. Configure the plugin from a clean consumer repo using local path entries in `.opencode/opencode.jsonc` and `.opencode/tui.jsonc`
3. Start OpenCode
4. Run `/supabase`
5. Complete login
6. Run at least one real Supabase tool
7. Confirm the README matches the actual shipped behavior

**Exit criteria:**

- a fresh user can install and use the plugin without repository context
- docs match actual behavior
- prototype cleanup status is explicit

## Recommended execution order

Current recommended next step: Task 8.

1. Task 1: Scaffold the dual-target package
2. Task 2: Make CLI install work with manual config as a fallback
3. Task 3: Recreate `/supabase` as a dialog shell
4. Task 4: Split shared OAuth, API, and config code
5. Task 5: Add plugin-owned auth persistence
6. Task 6: Rebuild the auth hook around public plugin APIs
7. Task 7: Complete the real OAuth dialog flow
8. Task 8: Implement the first authenticated Supabase tool
9. Task 9: Implement the remaining tools and token lifecycle behavior
10. Task 10: Finish README and decide how to retire prototype artifacts

## Task 1: Scaffold the dual-target package

**Files:**

- Modify: `package.json`
- Modify: `tsconfig.json`
- Delete or replace: `index.ts`
- Create: `src/server/index.ts`
- Create: `src/tui/index.tsx`
- Reference: `packages/plugin/package.json:11`
- Reference: `packages/opencode/src/plugin/shared.ts:89`
- Reference: `packages/opencode/src/plugin/shared.ts:277`
- Reference: `packages/plugin/src/index.ts:44`
- Reference: `packages/plugin/src/tui.ts:437`

**Steps**

1. Start from the existing `git init` + `bun init -y` scaffold in `/home/jumski/Code/jumski/opencode-supabase`; do not assume a blank folder.
2. Rewrite `package.json` with `type: "module"` and explicit exports for `./server` and `./tui`.
3. Add dependencies for `@opencode-ai/plugin`, `@opencode-ai/sdk`, `zod`, and `open`.
4. Add dev dependencies needed to typecheck TSX.
5. Replace the starter `index.ts` entrypoint with explicit `src/server/index.ts` and `src/tui/index.tsx` entrypoints.
6. Give both entrypoints an explicit plugin `id` so local path installs work too.
7. Start with this module shape:

```ts
// src/server/index.ts
import type { Plugin } from "@opencode-ai/plugin";

const server: Plugin = async (input, options) => {
  return {
    auth: undefined,
    tool: undefined,
  };
};

export default { id: "supabase", server };
```

```tsx
// src/tui/index.tsx
import type { TuiPlugin } from "@opencode-ai/plugin/tui";

const tui: TuiPlugin = async (api, options) => {
  api.command.register(() => []);
};

export default { id: "supabase", tui };
```

8. Use this export shape:

```json
{
  "exports": {
    "./server": "./src/server/index.ts",
    "./tui": "./src/tui/index.tsx"
  }
}
```

**Verification**

- `bun install`
- `bun run typecheck`

## Task 2: Make CLI install work with manual config as a fallback

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Reference: `packages/opencode/src/plugin/install.ts:145`
- Reference: `packages/opencode/src/plugin/install.ts:421`
- Reference: `packages/opencode/test/plugin/install.test.ts:112`
- Reference: `packages/opencode/src/config/config.ts:286`
- Reference: `packages/opencode/src/config/tui.ts:57`

**Steps**

1. Keep the published package name stable as `opencode-supabase`.
2. Ensure the package manifest exposes both plugin targets so CLI install and config-based loading can resolve both.
3. Document the primary install path as:

```bash
opencode plugin ../../opencode-supabase
```

4. Document manual local-path configuration as the fallback path.
5. Document that the same plugin spec must be added to both `.opencode/opencode.jsonc` and `.opencode/tui.jsonc` for the fallback flow.
6. Use a consumer-repo-relative example path such as:

```json
{
  "plugin": ["../../opencode-supabase"]
}
```

7. Explain that this manual path is resolved relative to the `.opencode/` directory, not the consumer repo root, so a sibling checkout usually needs `../../opencode-supabase`.
8. Explain that server and TUI load from separate config surfaces, so both files must be configured for the manual fallback.
9. Do not document manual `opencode.jsonc`-only install as sufficient for the full Phase 1 flow.

**Verification**

- `bun run typecheck`
- run `opencode plugin ../../opencode-supabase` from a consumer repo on OpenCode `>= 1.3.4`
- confirm both config surfaces were patched
- start OpenCode from the consumer repo and confirm both targets load
- optional fallback: add the plugin path to both config surfaces manually and confirm the same result

## Task 3: Recreate `/supabase` as a dialog shell

**Files:**

- Create: `src/tui/index.tsx`
- Create: `src/tui/dialog.tsx`
- Reference: `packages/plugin/src/tui.ts:389`
- Reference: `packages/opencode/src/cli/cmd/tui/component/dialog-command.tsx:86`

**Steps**

1. In `src/tui/index.tsx`, call `api.command.register(() => [...])`.
2. Register one command with this shape:

- title: `Connect Supabase`
- value: `supabase.connect`
- slash: `{ name: "supabase" }`

3. Create a simple dialog component in `src/tui/dialog.tsx`.
4. Make the command open the dialog through `api.ui.dialog.replace(...)`.
5. The first dialog version only needs title, explanatory copy, and close/cancel behavior.
6. Do not add OAuth behavior yet.

**Verification**

- `bun run typecheck`
- `bun test test/plugin-exports.test.ts`
- start OpenCode
- run `/supabase`
- confirm the dialog opens and closes without errors

## Task 4: Split shared OAuth, API, and config code out of the prototype

**Files:**

- Create: `src/shared/types.ts`
- Create: `src/shared/cfg.ts`
- Create: `src/shared/oauth.ts`
- Create: `src/shared/api.ts`
- Donor: `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:21`
- Donor: `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:67`
- Donor: `.worktrees/supabase/packages/opencode/src/plugin/codex.ts:90`

**Steps**

1. Move pure OAuth helpers into `src/shared/oauth.ts`.
2. Move Management API HTTP helpers into `src/shared/api.ts`. Keep auth exchange and refresh logic isolated so later tasks can move it behind a broker-backed boundary instead of copying the prototype's Basic-auth secret exchange literally.
3. Create `src/shared/cfg.ts` that reads plugin options and env vars into one normalized config object.
4. Replace secret-bearing prototype values with broker-aware config and a public-client identifier. Do not carry forward the prototype `CLIENT_SECRET`.
5. Validate the exact Supabase authorize requirements and leave room for a later broker-backed exchange step rather than hard-coding a direct token exchange assumption here.
6. Keep shared API endpoints as constants in shared code.
7. Fail fast if callback port configuration is missing or invalid, and keep public `client_id` lookup isolated so later tasks can swap from override-based config to a built-in default cleanly.

**Task 4 note:**

- This task extracts reusable authorize, config, and Management API helpers only.
- The live token exchange and refresh path is no longer expected to happen directly from the plugin.
- Task 6 and Task 9 should move those confidential token operations behind the broker contract in `docs/supabase-oauth-broker-contract.md`.

**Verification**

- `bun run typecheck`

## Task 5: Add plugin-owned auth persistence

**Files:**

- Create: `src/server/store.ts`
- Reference: `packages/plugin/src/index.ts:27`
- Reference: `packages/plugin/src/tool.ts:3`

**Steps**

1. Create `src/server/store.ts` because external tools cannot call host `Auth.get`.
2. Store credentials in a plugin-owned JSON file under the project `.opencode` directory.
3. Resolve the file path from `input.worktree` and `input.directory`.
4. Use a minimal persisted schema like:

```ts
type Saved = {
  version: 1;
  auth?: {
    access: string;
    refresh: string;
    expires: number;
  };
};
```

5. Export helpers for `file(input)`, `read(input)`, `write(input, auth)`, and `clear(input)`.
6. When OAuth succeeds, write the token set to this store in addition to letting OpenCode persist provider auth normally.

**Verification**

- `bun run typecheck`

## Task 6: Rebuild the auth hook around public plugin APIs and broker-backed exchange

**Files:**

- Create: `src/shared/broker.ts`
- Create: `src/server/auth.ts`
- Modify: `src/server/index.ts`
- Modify: `src/shared/cfg.ts`
- Reference: `docs/supabase-oauth-broker-contract.md`
- Reference: `packages/plugin/src/index.ts:56`
- Reference: `packages/opencode/src/provider/auth.ts:165`
- Reference: `packages/opencode/src/server/routes/provider.ts:87`
- Reference: `packages/opencode/src/mcp/oauth-callback.ts:54`

**Steps**

1. Move the local callback server logic into `src/server/auth.ts`.
2. Keep the auth hook shape:

```ts
auth: {
  provider: "supabase",
  methods: [
    {
      type: "oauth",
      label: "Supabase",
      authorize() {
        // return url, instructions, method, callback
      },
    },
  ],
}
```

3. Keep the browser-based flow: start a local callback server, build the authorize URL locally, and return `{ url, instructions, method: "auto", callback }`.
4. Replace any single global pending OAuth object in plugin code with a state-keyed map. Use `packages/opencode/src/mcp/oauth-callback.ts` as a hardening reference for pending-state handling and port-in-use checks.
5. Move HTML success and error responses into `src/server/auth.ts`.
6. Create `src/shared/broker.ts` for the broker HTTP client. It should implement only the contract in `docs/supabase-oauth-broker-contract.md`, not a generic proxy client, and it should read the broker base URL through one isolated config lookup so an official default and local-development override can coexist cleanly.
7. In the callback, exchange the code by calling broker `POST /exchange` with `code`, `code_verifier`, and `redirect_uri`, then write the returned tokens to `src/server/store.ts`, and return `{ type: "success", access, refresh, expires }` so OpenCode persists provider auth too.
8. Do not add custom HTTP routes.

**Verification**

- `bun run typecheck`

## Task 7: Complete the real `/supabase` OAuth dialog flow

**Files:**

- Modify: `src/tui/index.tsx`
- Modify: `src/tui/dialog.tsx`
- Reference: `packages/plugin/src/tui.ts:419`
- Reference: `packages/opencode/src/cli/cmd/tui/component/dialog-supabase.tsx:10`
- Reference: `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx:83`
- Reference: `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx:145`
- Reference: `packages/opencode/src/mcp/index.ts:769`

**Steps**

1. Keep `/supabase` as a dialog, not a route.
2. Port the core flow into the dialog:

- call `api.client.provider.oauth.authorize({ providerID: "supabase", method: 0 })`
- explicitly attempt to open the returned URL in the browser
- show the URL and instructions in the dialog even if auto-open fails
- await `api.client.provider.oauth.callback({ providerID: "supabase", method: 0 })`

3. On failure, show `api.ui.toast({ variant: "error", ... })` and close the dialog.
4. On success, close the dialog and show a success toast like:

- `Connected to Supabase. You can now list orgs, list projects, create projects, and fetch project API keys.`

5. Do not assume the public TUI plugin API can force the same internal sync refresh used by the built-in provider dialog. Focus on the required visible outcome: automatic close plus success confirmation.
6. Keep the rendered dialog intentionally simple: title, browser-opening status, manual URL fallback, waiting state, and clear error handling.
7. Treat broker failures as auth failures in the dialog surface. Do not leak raw broker transport details into the default user-facing copy.
8. Research any stronger post-auth refresh/bootstrap behavior separately after the simple happy path is working. Do not block phase completion on internal parity with host dialogs.

**Verification**

- `bun run typecheck`
- start OpenCode
- run `/supabase`
- confirm browser auto-open is attempted
- if browser auto-open fails, confirm the dialog still exposes the URL and instructions
- complete OAuth
- confirm the dialog closes and success toast appears

## Task 8: Implement the first authenticated Supabase tool

**Files:**

- Create: `src/server/tools.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/store.ts`
- Reference: `packages/plugin/src/tool.ts:29`

**Steps**

1. Create one narrow vertical slice first.
2. Implement `supabase_list_projects` unless extraction reveals `supabase_list_organizations` is materially simpler.
3. Add one shared helper in `src/server/tools.ts` to read saved auth and refresh through the broker if expired.
4. Add one shared HTTP helper for Supabase Management API calls.
5. When no auth exists, fail with a clear message telling the user to run `/supabase` first.
6. Prove the tool uses persisted plugin-owned auth, not a temporary in-memory value.

**Verification**

- `bun run typecheck`
- complete `/supabase` login
- run the first real tool
- restart OpenCode
- run the same tool again without re-login

## Task 9: Implement the remaining tools and token lifecycle behavior

**Files:**

- Modify: `src/server/tools.ts`
- Modify: `src/server/auth.ts`
- Modify: `src/server/store.ts`
- Modify: `src/server/index.ts`
- Donor: `.worktrees/supabase/packages/opencode/src/plugin/supabase.ts:404`

**Steps**

1. Port the remaining tool ids:

- `supabase_login`
- `supabase_list_organizations`
- `supabase_list_projects`
- `supabase_create_project`
- `supabase_get_project_api_keys`

2. Keep the existing argument names from the prototype where possible.
3. Update the shared auth helper so expired access tokens refresh automatically via broker `POST /refresh`.
4. When refresh succeeds, update both plugin-owned store and host auth via `input.client.auth.set("supabase", ...)`.
5. When refresh fails with an auth error, clear both storage locations and return a clear reconnect instruction.
6. Keep response behavior simple: formatted JSON on success and clear upstream-aware errors on failure.

**Verification**

- `bun run typecheck`
- run every tool at least once on a real Supabase account
- force an expired-token scenario and confirm refresh succeeds
- force an invalid-refresh-token scenario and confirm reconnect guidance is shown

## Task 10: Finish README and decide how to retire prototype artifacts

**Files:**

- Modify: `README.md`
- Optional cleanup target: `.worktrees/supabase/packages/opencode/src/plugin/index.ts:15`
- Optional cleanup target: `.worktrees/supabase/packages/opencode/src/cli/cmd/tui/component/dialog-supabase.tsx:10`

**Steps**

1. Keep the README focused on:

- install
- required config and env
- `/supabase` login flow
- available tool ids

2. Show the primary install path as:

```bash
opencode plugin ../../opencode-supabase
```

3. Show the optional manual install fallback as:

```json
{
  "plugin": ["../../opencode-supabase"]
}
```

and state that the same local path entry must be added to both `.opencode/opencode.jsonc` and `.opencode/tui.jsonc` in a consumer repo.

4. Document auth configuration in this priority order:

- built-in OpenCode-managed public `client_id`
- plugin options or env vars for callback port if the callback listener remains configurable
- optional broker URL override only if local development support exposes one

5. Decide whether prototype cleanup is a separate follow-up or explicitly deferred.
6. If cleanup happens, keep it in a separate commit from the external plugin implementation.

**Verification**

- follow the README from scratch
- install the plugin
- run `/supabase`
- complete login
- run at least one real tool

---

## Implementation notes that should not be skipped

- Do not collapse everything back into one mixed module.
- Do not rely on host `Auth.get` from the external plugin.
- Do not add custom server routes.
- Do not document manual `opencode.jsonc`-only installation as the primary path.
- Do not assume browser auto-open will always succeed.
- Do not promise multiple simultaneous Supabase OAuth sessions.
- Do not ship hardcoded client secrets.
- Do not move browser callback ownership into the broker.
- Do not turn the broker into a generic Supabase API proxy.
- Do not bypass the broker for exchange or refresh on the Management API OAuth flow.

## Out of scope by design

- provider-picker integration
- new core plugin APIs
- new server routes
- broad CI, lint, or publishing automation
- full concurrent auth-session support for the same provider

## Minimal smoke checklist for the eventual implementation

1. `bun install`
2. `bun run typecheck`
3. Configure the plugin from a consumer repo via `.opencode/opencode.jsonc` and `.opencode/tui.jsonc`
4. Start OpenCode
5. Run `/supabase`
6. Confirm browser open is attempted and manual fallback is visible if needed
7. Complete browser OAuth
8. Confirm success toast
9. Ask the agent to run `supabase_list_projects`
