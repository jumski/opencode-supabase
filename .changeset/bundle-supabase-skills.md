---
"opencode-supabase": minor
---

Bundle Supabase agent skills as vendored files with configurable runtime registration

- Vendor `supabase` and `supabase-postgres-best-practices` skill directories from `supabase/agent-skills`
- Add `skills:sync` script to update vendored skills from upstream (defaults to latest default branch, accepts explicit commit/ref)
- Register skill paths via plugin `config` hook; disable per-skill or entirely through plugin options
- Add tests for skill resolution and path registration
