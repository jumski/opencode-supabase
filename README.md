# opencode-supabase

External Supabase plugin package for OpenCode with separate server and TUI entrypoints.

## Install

Compatibility: external TUI plugin loading through `.opencode/tui.jsonc` and the `opencode plugin` workflow require OpenCode `>= 1.3.4`. OpenCode `1.2.27` rejects the `plugin` key in `tui.jsonc`, so `/supabase` cannot be registered there.

Preferred install on a compatible OpenCode version:

```bash
opencode plugin ../../opencode-supabase
```

Optional manual setup if you want to wire the config yourself:

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

Use a sibling checkout from the consumer repo so the relative path resolves correctly. For manual config, the relative path is resolved from inside `.opencode/`, not from the consumer repo root, so `../../opencode-supabase` is correct for a sibling checkout. Both files must be configured because server and TUI plugins load from separate config surfaces.

## Development

Install dependencies:

```bash
bun install
```

Run typecheck:

```bash
bun run typecheck
```

## Supabase OAuth Broker

The broker is a single Supabase Edge Function that handles confidential token operations against `https://api.supabase.com/v1/oauth/token`. It exposes two endpoints:

- `POST /exchange` - exchange an authorization code for tokens
- `POST /refresh` - refresh an access token

The plugin owns browser authorization, PKCE, the local callback server, and local token storage. The broker holds `client_secret` and makes token requests using Basic auth.

### Local development

The plugin inherits environment variables from the OpenCode CLI process. For local broker development, point the plugin at your local function URL before launching OpenCode:

```bash
export OPENCODE_SUPABASE_BROKER_URL=http://127.0.0.1:54321/functions/v1/opencode-supabase-broker
opencode
```

Start the broker locally:

```bash
supabase functions serve opencode-supabase-broker --env-file .env.local
```

Required secrets (set in `.env.local` or via `supabase secrets set`):

```bash
OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET=<your_supabase_oauth_app_client_secret>
```

Optional overrides:

```bash
# Defaults shown
OPENCODE_SUPABASE_OAUTH_TOKEN_URL=https://api.supabase.com/v1/oauth/token
OPENCODE_SUPABASE_ALLOWED_REDIRECT_HOSTS=127.0.0.1,localhost
OPENCODE_SUPABASE_ALLOWED_REDIRECT_PATHS=/auth/callback
```

The broker fails fast on the first request if required secrets are missing — callers receive a generic `500 server_error` JSON response. Detailed cause is logged for operators; no internal details are exposed to callers.

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

The plugin currently requires a real broker base URL to be configured through `OPENCODE_SUPABASE_BROKER_URL`. There is intentionally no placeholder built-in default.

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
