# Changelog

## 0.0.7

### Patch Changes

- 34202de: Fix Supabase OAuth callback collisions by retrying a fixed localhost callback window (`14589`-`14591`) and stopping the callback listener as soon as auth finishes.

## 0.0.6

### Patch Changes

- d64d8f3: Dummy release test for Changesets workflow.

All notable changes to this project will be documented in this file.

## 0.0.5 - 2026-04-14

### Fixed

- Fix Supabase auth failures in non-git directories when invalid host `worktree` values caused writes to `/.opencode` instead of the session directory.
- Harden auth store path resolution to reject root, unrelated, and nested-inside-directory `worktree` values before falling back to the session directory.
- Add regression coverage across store, auth callback, and tool auth read/refresh/clear flows for invalid `worktree` inputs.
