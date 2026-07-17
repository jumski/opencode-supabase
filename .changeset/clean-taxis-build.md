---
"opencode-supabase": patch
---

Ship the rich `/supabase` TUI as compiled JavaScript and resolve OpenTUI/Solid through OpenCode's host runtime modules. This avoids raw TSX transformation failures under `node_modules` without loading a plugin-private renderer.
