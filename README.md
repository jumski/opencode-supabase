# opencode-supabase

External Supabase plugin package for OpenCode with separate server and TUI entrypoints.

## Install

Primary package install:

```bash
opencode plugin opencode-supabase
```

Local development install:

```bash
opencode plugin ../opencode-supabase
```

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
