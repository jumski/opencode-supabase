# Changelog

All notable changes to this project will be documented in this file.

## 0.0.5 - 2026-04-14

### Fixed

- Fix Supabase auth failures in non-git directories when invalid host `worktree` values caused writes to `/.opencode` instead of the session directory.
- Harden auth store path resolution to reject root, unrelated, and nested-inside-directory `worktree` values before falling back to the session directory.
- Add regression coverage across store, auth callback, and tool auth read/refresh/clear flows for invalid `worktree` inputs.
