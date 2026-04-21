---
"opencode-supabase": patch
---

Replace fleeting success toasts with a persistent post-auth dialog that lists concrete example prompts (`list my Supabase projects`, `list my Supabase organizations`, `for organization <name>, list available regions`). The waiting dialog now uses centered built-in `DialogAlert` instead of a custom off-center shell. Browser success page stays minimal with a small prompt snippet. Dismissing the waiting dialog suppresses the success dialog to avoid surprise popups. Also fixes error dialog retry to start a fresh OAuth flow instead of reopening stale browser tabs.

Refs: #22, #27
