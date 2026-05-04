# Agent Notes

## Caveman

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".

## External References

For Supabase Management API work, prefer the markdownized docs:

- https://supabase.com/docs/reference/api/introduction.md

Use this reference when implementing or reviewing authenticated Supabase API tools.

## Bundled Supabase Skills

`skills/` contains real vendored files synced from `supabase/agent-skills` release tarballs.

- Do not replace `skills/` with a symlink or submodule.
- Do not fetch skills during plugin startup, normal build, or release artifact generation.
- Use `bun run skills:sync` to update vendored skills.
- Review skill diffs and `skills/.upstream.json` before release.
