---
'opencode-supabase': patch
---

Add `supabase_list_regions` tool — calls `GET /v1/projects/available-regions?organization_slug=<slug>` so the LLM can discover valid region codes before creating projects.
