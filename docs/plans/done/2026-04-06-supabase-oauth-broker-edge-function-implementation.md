# Supabase OAuth Broker Edge Function Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the reference Supabase OAuth broker as a single Supabase Edge Function with two endpoints, `/exchange` and `/refresh`, while keeping the business logic portable and the Deno-specific runtime surface isolated to the function entrypoint.

**Architecture:** The deployed broker is one Supabase Edge Function named `opencode-supabase-broker`. The entrypoint owns `Deno.serve()`, `Deno.env.get()`, path routing, and nothing else Deno-specific. All other files in the function directory use only web-standard APIs such as `Request`, `Response`, `URL`, `Headers`, `fetch`, and `URLSearchParams`. The implementation must conform to `docs/plans/2026-04-06-supabase-oauth-broker-contract.md` exactly and stay stateless: no database, no token storage, no broker-owned callback flow.

**Tech Stack:** Supabase CLI, Supabase Edge Functions, TypeScript, web-standard Fetch APIs, relative imports only.

---

## Implementation constraints

- Keep the broker in `supabase/functions/opencode-supabase-broker/`.
- Deploy only one Edge Function.
- Route both endpoints inside that one function:
  - `POST /exchange`
  - `POST /refresh`
- Do not create a shared top-level broker package yet.
- Do not use `Deno.*` outside `supabase/functions/opencode-supabase-broker/index.ts`.
- Do not use `npm:` or `jsr:` specifiers in source files.
- Prefer zero dependencies. If any dependency becomes necessary, isolate it and avoid runtime-specific imports leaking through the codebase.
- Keep the implementation stateless and database-free.

## Repo layout target

```text
supabase/
  config.toml
  functions/
    opencode-supabase-broker/
      index.ts
      handlers.ts
      http.ts
      supabase.ts
      types.ts
```

### File responsibilities

- `supabase/config.toml`
  - minimal Supabase local/dev configuration
  - enough to support Edge Functions development and deployment
- `supabase/functions/opencode-supabase-broker/index.ts`
  - `Deno.serve()`
  - read env/secrets with `Deno.env.get()`
  - parse request path and method
  - construct normalized config object
  - call portable handler functions
- `supabase/functions/opencode-supabase-broker/handlers.ts`
  - implement `/exchange` and `/refresh` handlers
  - use only web-standard APIs
- `supabase/functions/opencode-supabase-broker/http.ts`
  - JSON parsing helpers
  - error response helpers
  - method/path guards
- `supabase/functions/opencode-supabase-broker/supabase.ts`
  - call `https://api.supabase.com/v1/oauth/token`
  - build form requests and Basic auth header
  - normalize Supabase token responses
- `supabase/functions/opencode-supabase-broker/types.ts`
  - request/response types
  - normalized config and error types

## Required secrets and config

The Edge Function must read these values from environment/secrets in `index.ts` and pass a plain object into the portable layers:

- `OPENCODE_SUPABASE_OAUTH_CLIENT_ID`
- `OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET`
- optional `OPENCODE_SUPABASE_OAUTH_TOKEN_URL` defaulting to `https://api.supabase.com/v1/oauth/token`
- optional `OPENCODE_SUPABASE_ALLOWED_REDIRECT_HOSTS` defaulting to `localhost`
- optional `OPENCODE_SUPABASE_ALLOWED_REDIRECT_PATHS` defaulting to `/auth/callback`

The portable layers must not call `Deno.env.get()` directly.

## Request validation rules

### `/exchange`

Accept only:

```json
{
  "code": "string",
  "code_verifier": "string",
  "redirect_uri": "http://localhost:14589/auth/callback"
}
```

Reject when:

- method is not `POST`
- body is not valid JSON
- any required field is missing
- any required field is not a non-empty string
- `redirect_uri` host is not allowlisted
- `redirect_uri` path is not allowlisted
- `redirect_uri` protocol is not `http:`

### `/refresh`

Accept only:

```json
{
  "refresh_token": "string"
}
```

Reject when:

- method is not `POST`
- body is not valid JSON
- `refresh_token` is missing or empty

## Supabase upstream behavior

For `/exchange`, send:

```text
POST https://api.supabase.com/v1/oauth/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=authorization_code
code=<code>
redirect_uri=<redirect_uri>
code_verifier=<code_verifier>
```

For `/refresh`, send:

```text
POST https://api.supabase.com/v1/oauth/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=refresh_token
refresh_token=<refresh_token>
```

Normalize success responses to:

```json
{
  "access_token": "string",
  "refresh_token": "string",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

## Error handling contract

Return JSON only. Never return HTML.

Error shape:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "redirect_uri must use the local plugin callback pattern"
  }
}
```

Status mapping:

- `400` -> malformed input or unsupported path/method
- `401` -> upstream auth rejection or revoked token semantics
- `429` -> broker rate limit
- `502` -> malformed upstream response or upstream transport failure

Do not forward raw Supabase responses directly to callers. Normalize them first.

## Local development expectations

### Supabase project location

Keep the reference broker implementation in this repo at the conventional Supabase CLI root:

- `supabase/`

This keeps the broker colocated with the plugin while the architecture is still evolving, without coupling the protocol contract to this deployment choice.

### `supabase/config.toml`

Create the minimal config needed for Edge Functions work. The plan should prefer a simple config that works over aggressive service trimming. The important requirement is that the broker function remains stateless and does not depend on Postgres, Auth, Storage, or other Supabase product services.

If local config can disable unneeded local services safely, do so as a convenience, not as a protocol requirement.

### Local secrets

Document local dev setup for function secrets such as:

```bash
supabase secrets set \
  OPENCODE_SUPABASE_OAUTH_CLIENT_ID=... \
  OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET=...
```

If local redirect allowlist configuration is overrideable, document that too.

## Verification plan

### Broker-only verification

1. Start or serve the Edge Function locally.
2. Send a malformed `/exchange` request and confirm `400` JSON.
3. Send a malformed `/refresh` request and confirm `400` JSON.
4. Send a request with a disallowed `redirect_uri` and confirm `400` JSON.
5. If you have live test credentials, complete a real `/exchange` call and confirm normalized token JSON.
6. If you have a real refresh token, complete a real `/refresh` call and confirm normalized token JSON.

### Integration verification with plugin

1. Configure the plugin to call the local or deployed broker.
2. Run `/supabase` from OpenCode.
3. Complete browser authorization.
4. Confirm the local plugin callback receives `code` and `state`.
5. Confirm the plugin exchanges through the broker and stores tokens locally.
6. Confirm one authenticated tool works.
7. Force an expired access token and confirm broker-backed refresh works.

## Task breakdown

### Task 1: Scaffold the Supabase broker directory

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/functions/opencode-supabase-broker/index.ts`
- Create: `supabase/functions/opencode-supabase-broker/types.ts`

**Step 1: Write the failing verification target**

Define the expected file layout and local serve command in the plan notes so the implementation has a concrete target.

**Step 2: Create the minimal Supabase CLI layout**

Add `supabase/`, a minimal `config.toml`, and the function directory with a placeholder `index.ts`.

**Step 3: Add the single Deno-specific entrypoint skeleton**

Create `index.ts` with `Deno.serve()` and placeholder route handling for `/exchange` and `/refresh`.

**Step 4: Verify structure**

Run the local Supabase function serve command or equivalent structure check.

### Task 2: Add portable request and response helpers

**Files:**
- Modify: `supabase/functions/opencode-supabase-broker/index.ts`
- Create: `supabase/functions/opencode-supabase-broker/http.ts`
- Modify: `supabase/functions/opencode-supabase-broker/types.ts`

**Step 1: Write the failing test or manual probe**

Define a malformed `/exchange` request and expected `400` JSON response.

**Step 2: Implement portable HTTP helpers**

Add helpers for JSON parsing, JSON responses, and normalized error responses using only web-standard APIs.

**Step 3: Wire routing through those helpers**

Keep `index.ts` responsible only for env loading and dispatch.

**Step 4: Verify malformed input behavior**

Probe `/exchange` and `/refresh` with invalid payloads and confirm normalized JSON errors.

### Task 3: Implement `/exchange`

**Files:**
- Modify: `supabase/functions/opencode-supabase-broker/index.ts`
- Create: `supabase/functions/opencode-supabase-broker/handlers.ts`
- Create: `supabase/functions/opencode-supabase-broker/supabase.ts`
- Modify: `supabase/functions/opencode-supabase-broker/types.ts`

**Step 1: Write the failing verification case**

Define a valid-looking `/exchange` request and verify it fails before handler implementation.

**Step 2: Implement strict `/exchange` validation**

Require `code`, `code_verifier`, and `redirect_uri`, and validate the loopback redirect rules.

**Step 3: Implement Supabase token exchange**

Build the upstream form request and Basic auth header using the normalized config object from `index.ts`.

**Step 4: Normalize the success response**

Return only the portable token payload shape.

**Step 5: Verify against malformed and real inputs**

Confirm both invalid and valid cases behave as expected.

### Task 4: Implement `/refresh`

**Files:**
- Modify: `supabase/functions/opencode-supabase-broker/handlers.ts`
- Modify: `supabase/functions/opencode-supabase-broker/supabase.ts`
- Modify: `supabase/functions/opencode-supabase-broker/types.ts`

**Step 1: Write the failing verification case**

Define a valid-looking `/refresh` request and verify it fails before implementation.

**Step 2: Implement strict `/refresh` validation**

Require only `refresh_token`.

**Step 3: Implement Supabase refresh call**

Use the same token endpoint and Basic auth mechanism with `grant_type=refresh_token`.

**Step 4: Normalize the refresh response**

Return the same token payload shape as `/exchange`.

**Step 5: Verify malformed and valid refresh behavior**

Confirm invalid payloads fail cleanly and real refresh works when test credentials are available.

### Task 5: Add final hardening and docs

**Files:**
- Modify: `supabase/config.toml`
- Modify: `supabase/functions/opencode-supabase-broker/index.ts`
- Modify: `supabase/functions/opencode-supabase-broker/http.ts`
- Modify: `README.md`

**Step 1: Add remaining guardrails**

Confirm method/path rejection, JSON-only responses, and non-leaky error normalization.

**Step 2: Add local development notes**

Document local serve, secret setup, and the function URL shape the plugin should call.

**Step 3: Add deployment notes**

Document how this function would be deployed as the reference broker implementation.

**Step 4: Verify end-to-end with the plugin**

Confirm `/supabase` login plus one tool call works using the broker.

## Non-goals for this implementation plan

- building a Management API passthrough proxy
- storing refresh tokens in the broker
- introducing broker-owned auth sessions
- adding a login-init handshake
- making the plugin callback broker-owned
- introducing Deno-specific behavior in helper files outside `index.ts`
