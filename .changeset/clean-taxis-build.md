---
"opencode-supabase": patch
---

Ship the TUI entrypoint as compiled JavaScript and use OpenCode's host dialogs for `/supabase` authorization. This avoids both TSX transformation and duplicate renderer failures when loading the plugin from `node_modules`.
