# opencode-supabase

External Supabase plugin package for OpenCode with separate server and TUI entrypoints.

## Install

Compatibility: external TUI plugin loading through `.opencode/tui.jsonc` and the `opencode plugin` workflow require OpenCode `>= 1.3.4`. OpenCode `1.2.27` rejects the `plugin` key in `tui.jsonc`, so `/supabase` cannot be registered there.

Preferred install on a compatible OpenCode version:

```bash
opencode plugin /absolute/path/to/opencode-supabase
```

Sibling-checkout alternative:

```bash
opencode plugin ../../opencode-supabase
```

Optional manual setup if you want to wire the config yourself:

Absolute-path example:

`.opencode/opencode.jsonc`

```json
{
  "plugin": ["/absolute/path/to/opencode-supabase"]
}
```

`.opencode/tui.jsonc`

```json
{
  "plugin": ["/absolute/path/to/opencode-supabase"]
}
```

Sibling-checkout relative example:

`.opencode/opencode.jsonc`

```json
{
  "plugin": ["../../opencode-supabase"]
}
```

`.opencode/tui.jsonc`

```json
{
  "plugin": ["../../opencode-supabase"]
}
```

Absolute paths are the clearest option for manual config. If you prefer a relative path, it is resolved from inside `.opencode/`, not from the consumer repo root. For a sibling checkout, `../../opencode-supabase` is usually correct. Both files must be configured because server and TUI plugins load from separate config surfaces.

## Development

Install dependencies:

```bash
bun install
```

Run typecheck:

```bash
bun run typecheck
```

## Reference Docs

For the Supabase Management API reference, see:

- https://supabase.com/docs/reference/api/introduction

## Supabase OAuth Broker

The broker is a single Supabase Edge Function that handles confidential token operations against `https://api.supabase.com/v1/oauth/token`. It exposes two endpoints:

- `POST /exchange` - exchange an authorization code for tokens
- `POST /refresh` - refresh an access token

The plugin owns browser authorization, PKCE, the local callback server, and local token storage. The broker holds `client_secret` and makes token requests using Basic auth.

## Local Setup

There are two separate environments to configure:

1. the local Supabase Edge Function runtime
2. the consumer project shell that launches `opencode`

### 1. Broker runtime environment

These variables are used by the local Supabase Edge Function.

Required:

```bash
OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET=<your_supabase_oauth_app_client_secret>
```

Optional:

```bash
# Defaults shown
OPENCODE_SUPABASE_OAUTH_TOKEN_URL=https://api.supabase.com/v1/oauth/token
OPENCODE_SUPABASE_ALLOWED_REDIRECT_HOSTS=localhost
OPENCODE_SUPABASE_ALLOWED_REDIRECT_PATHS=/auth/callback
```

Recommended local file:

- `supabase/functions/.env`

Committed template:

- `supabase/functions/.env.example`

Start the broker locally:

```bash
supabase functions serve opencode-supabase-broker --env-file supabase/functions/.env
```

The broker fails fast on the first request if required secrets are missing - callers receive a generic `500 server_error` JSON response. Detailed cause is logged for operators; no internal details are exposed to callers.

### 2. Consumer project / OpenCode environment

These variables must be present in the shell before launching `opencode` in the consumer repo.

Required:

```bash
export OPENCODE_SUPABASE_BROKER_URL=http://localhost:54321/functions/v1/opencode-supabase-broker
export OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
export OPENCODE_SUPABASE_OAUTH_PORT=14589
```

Notes:

- `OPENCODE_SUPABASE_BROKER_URL` is required. There is intentionally no built-in placeholder default.
- `OPENCODE_SUPABASE_OAUTH_CLIENT_ID` must match the OAuth app configured for the broker.
- `OPENCODE_SUPABASE_OAUTH_PORT` controls the local callback URL the plugin listens on.
- The callback path is `/auth/callback`, so the full local callback URL is `http://localhost:<port>/auth/callback`.

Your Supabase OAuth app must allow that redirect URI.

### Local development

The plugin inherits environment variables from the OpenCode CLI process. For local broker development, point the plugin at your local function URL before launching OpenCode:

```bash
export OPENCODE_SUPABASE_BROKER_URL=http://localhost:54321/functions/v1/opencode-supabase-broker
opencode
```

Quick local test flow:

1. create `supabase/functions/.env` from `supabase/functions/.env.example`
2. start the broker locally
3. export the consumer-project variables above
4. launch `opencode` in the consumer repo
5. run `/supabase`

### Deployment

Deploy the broker as a single Supabase Edge Function:

```bash
supabase functions deploy opencode-supabase-broker
```

Set secrets in the Supabase dashboard or via CLI:

```bash
supabase secrets set \
  OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<client_id> \
  OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET=<client_secret>
```

The plugin should call the deployed function URL at:

```
https://<project-ref>.supabase.co/functions/v1/opencode-supabase-broker/exchange
https://<project-ref>.supabase.co/functions/v1/opencode-supabase-broker/refresh
```

The plugin currently requires a real broker base URL to be configured through `OPENCODE_SUPABASE_BROKER_URL`.

### Request and response shapes

Both endpoints accept JSON and return JSON. Error responses use a normalized shape:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "description of what was rejected"
  }
}
```

Status codes: `400` for malformed input, `401` for upstream auth rejection, `500` for broker misconfiguration or unexpected internal errors, `502` for upstream errors.

**Note:** Rate limiting (`429`) is deferred from the initial implementation.
