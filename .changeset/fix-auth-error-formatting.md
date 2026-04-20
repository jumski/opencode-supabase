---
'opencode-supabase': patch
---

Fix inconsistent auth error messages between toast/dialog and browser/TUI by extracting a shared `formatAuthError` helper that unwraps nested SDK error payloads.
