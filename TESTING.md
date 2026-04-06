# Local Development and Testing

## Current scope

This repo is currently testable for:

- plugin install/loading
- local broker startup
- plugin to broker OAuth exchange wiring
- `/supabase` auth flow wiring

This repo does not yet expose a real authenticated tool after login.

## Requirements

You need all of the following:

- Bun
- Supabase CLI
- OpenCode `>= 1.3.4`
- a Supabase OAuth app client ID and client secret

## 1. Broker runtime environment

These variables are used by the local Supabase Edge Function.

Required:

```bash
OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET=<your_supabase_oauth_app_client_secret>
```

Optional:

```bash
OPENCODE_SUPABASE_OAUTH_TOKEN_URL=https://api.supabase.com/v1/oauth/token
OPENCODE_SUPABASE_ALLOWED_REDIRECT_HOSTS=127.0.0.1,localhost
OPENCODE_SUPABASE_ALLOWED_REDIRECT_PATHS=/auth/callback
```

Recommended local file:

- `supabase/functions/.env`

Template:

- `supabase/functions/.env.example`

Start the broker locally from this repo:

```bash
supabase functions serve opencode-supabase-broker --env-file supabase/functions/.env
```

Expected local broker base URL:

```text
http://127.0.0.1:54321/functions/v1/opencode-supabase-broker
```

## 2. Consumer project / OpenCode environment

These variables must exist in the shell before launching `opencode` in the consumer project.

Required:

```bash
export OPENCODE_SUPABASE_BROKER_URL=http://127.0.0.1:54321/functions/v1/opencode-supabase-broker
export OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
export OPENCODE_SUPABASE_OAUTH_PORT=14589
```

Notes:

- `OPENCODE_SUPABASE_BROKER_URL` is required.
- `OPENCODE_SUPABASE_OAUTH_CLIENT_ID` must match the OAuth app used by the broker.
- `OPENCODE_SUPABASE_OAUTH_PORT` controls the local callback listener.
- The callback path is `/auth/callback`.

Full default callback example:

```text
http://127.0.0.1:14589/auth/callback
```

Your Supabase OAuth app must allow that redirect URI.

## Install the plugin in another repo

Preferred install uses an absolute path:

```bash
opencode plugin /absolute/path/to/opencode-supabase
```

Manual config with absolute paths:

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

If you use relative paths, they are resolved from `.opencode/`, not from the consumer repo root.

## Local test flow

### Terminal 1 - broker

In this repo:

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

Fill in real secrets in `supabase/functions/.env`, then run:

```bash
supabase functions serve opencode-supabase-broker --env-file supabase/functions/.env
```

### Terminal 2 - consumer repo

Export the required variables:

```bash
export OPENCODE_SUPABASE_BROKER_URL=http://127.0.0.1:54321/functions/v1/opencode-supabase-broker
export OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
export OPENCODE_SUPABASE_OAUTH_PORT=14589
```

Go to the consumer repo, launch OpenCode, then run:

```text
/supabase
```

## What successful testing means today

Right now, success means:

- broker starts locally
- plugin loads in the consumer repo
- `/supabase` starts the browser auth flow
- callback returns to the local plugin server
- code exchange goes through the broker successfully

It does not yet mean a real authenticated product tool is available afterward.

## Verification

From this repo:

```bash
bun run typecheck
bun test
```

Expected result:

- typecheck passes
- tests pass

## Troubleshooting

Missing broker URL in the plugin shell:

```bash
export OPENCODE_SUPABASE_BROKER_URL=http://127.0.0.1:54321/functions/v1/opencode-supabase-broker
```

Missing plugin client ID:

```bash
export OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
```

Missing plugin callback port:

```bash
export OPENCODE_SUPABASE_OAUTH_PORT=14589
```

Broker fails with generic `500`:

- verify `supabase/functions/.env` contains valid values for:
  - `OPENCODE_SUPABASE_OAUTH_CLIENT_ID`
  - `OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET`

Redirect rejected:

- verify all three match:
  - OAuth app redirect URI
  - plugin callback URI
  - broker allowlist
