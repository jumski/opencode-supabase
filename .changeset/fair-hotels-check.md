---
'opencode-supabase': patch
---

Fix Supabase OAuth callback collisions by retrying a fixed localhost callback window (`14589`-`14591`) and stopping the callback listener as soon as auth finishes.
