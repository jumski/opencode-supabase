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
