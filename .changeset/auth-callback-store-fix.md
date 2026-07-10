---
"opencode-supabase": patch
---

Fix the OAuth callback writing tokens to the wrong local auth store, and stop burning the one-time auth code when local persistence fails.

- #32: persist tokens against the per-flow pending auth entry (keyed by state) instead of the singleton callback server's first-call input, so concurrent flows for different directories no longer cross-write each other's store.
- #36: preflight auth-store writability before opening the browser, make auth-file writes atomic (temp file + rename), and surface a targeted recovery message when credentials cannot be saved locally after a successful code exchange.
