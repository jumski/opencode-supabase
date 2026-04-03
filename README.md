# opencode-supabase

External Supabase plugin package for OpenCode with separate server and TUI entrypoints.

## Install

Current supported local install:

```bash
opencode plugin ../opencode-supabase
```

Published package install via `opencode plugin opencode-supabase` is deferred until npm setup exists for this plugin.

The OpenCode plugin installer detects both exported targets and patches both plugin config surfaces under `.opencode/` during a normal happy-path install.

## Development

Install dependencies:

```bash
bun install
```

Run typecheck:

```bash
bun run typecheck
```
