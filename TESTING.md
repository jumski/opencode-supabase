# Testing

Use this guide to verify the local broker, plugin loading, and `/supabase` auth wiring.

## Current Scope

Testable today:

- plugin install and loading
- local broker startup
- OAuth redirect and callback wiring
- code exchange through the broker

Not included yet:

- a real authenticated Supabase product tool after login

## Requirements

- Bun
- Supabase CLI
- OpenCode `>= 1.3.4`
- Supabase OAuth app client ID and client secret

## Quick Local Test Flow

### Terminal 1: Start the broker

Create a local env file from this repo:

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

Set real values in `supabase/functions/.env`:

```bash
OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET=<your_supabase_oauth_app_client_secret>
```

Optional defaults:

```bash
OPENCODE_SUPABASE_OAUTH_TOKEN_URL=https://api.supabase.com/v1/oauth/token
OPENCODE_SUPABASE_ALLOWED_REDIRECT_HOSTS=localhost
OPENCODE_SUPABASE_ALLOWED_REDIRECT_PATHS=/auth/callback
```

Start the broker:

```bash
supabase functions serve opencode-supabase-broker --env-file supabase/functions/.env
```

Expected local broker URL:

```text
http://localhost:54321/functions/v1/opencode-supabase-broker
```

### Terminal 2: Launch OpenCode in a consumer repo

Install the plugin first if you have not already:

```bash
opencode plugin opencode-supabase
```

Export the required variables before launching OpenCode:

```bash
export OPENCODE_SUPABASE_BROKER_URL=http://localhost:54321/functions/v1/opencode-supabase-broker
export OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
```

Plugin uses fixed callback window:

```text
http://localhost:14589/auth/callback
http://localhost:14590/auth/callback
http://localhost:14591/auth/callback
```

Your Supabase OAuth app must allow all 3 redirect URIs above.

Important: update both local/dev OAuth app config and deployed OAuth app config before testing fallback behavior.

Then launch OpenCode and run:

```text
/supabase
```

After auth starts, ask your agent about Supabase-related capabilities to confirm the plugin is active in the session.

## Success Means

Successful testing today means:

- the broker starts locally
- the plugin loads in the consumer repo
- `/supabase` opens the browser auth flow
- the callback reaches the local plugin server
- the broker completes the code exchange

It does not yet mean a full authenticated Supabase tool is available afterward.

## Verification

From this repo, run:

```bash
bun run typecheck
bun test
```

Expected result:

- typecheck passes
- tests pass

## Troubleshooting

Missing broker URL in the OpenCode shell:

```bash
export OPENCODE_SUPABASE_BROKER_URL=http://localhost:54321/functions/v1/opencode-supabase-broker
```

Missing plugin client ID:

```bash
export OPENCODE_SUPABASE_OAUTH_CLIENT_ID=<your_supabase_oauth_app_client_id>
```

Broker returns a generic `500`:

- verify `supabase/functions/.env` contains valid values for `OPENCODE_SUPABASE_OAUTH_CLIENT_ID` and `OPENCODE_SUPABASE_OAUTH_CLIENT_SECRET`

Redirect rejected:

- verify the OAuth app redirect URI, plugin callback URI, and broker allowlist all match

All callback ports busy:

- plugin retries `14589`, `14590`, then `14591`
- if all 3 are busy, close other OpenCode sessions or stale local processes and retry
