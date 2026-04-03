# opencode-supabase

External Supabase plugin package for OpenCode with separate server and TUI entrypoints.

## Install

From a consumer repo, add this plugin to both config surfaces.

`.opencode/opencode.jsonc`

```json
{
  "plugin": ["../opencode-supabase"]
}
```

`.opencode/tui.jsonc`

```json
{
  "plugin": ["../opencode-supabase"]
}
```

Use a sibling checkout from the consumer repo so the relative path resolves correctly. Both files must be configured because server and TUI plugins load from separate config surfaces.

## Development

Install dependencies:

```bash
bun install
```

Run typecheck:

```bash
bun run typecheck
```
