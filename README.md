# opencode-supabase

Supabase plugin for OpenCode.

![opencode-supabase screenshot](assets/screenshot.png)

## Get started

Requires OpenCode `>= 1.3.4`.

```bash
opencode plugin opencode-supabase
```

Launch `opencode` in your project, then run:

```
/supabase
```

Connect your account and ask your agent about Supabase capabilities.

## Available today

- **Connect** your Supabase account from OpenCode
- **List** organizations and projects
- **Get** project API keys
- **Create** new Supabase projects

## Development

Install dependencies:

```bash
bun install
```

Run checks:

```bash
bun run typecheck
bun test
```

For local broker setup and end-to-end auth testing, see `TESTING.md`.

## Reference

- Supabase Management API: https://supabase.com/docs/reference/api/introduction
