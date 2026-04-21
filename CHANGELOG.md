# Changelog

## 0.0.8

### Patch Changes

- 958036d: Replace fleeting success toasts with a persistent post-auth dialog that lists concrete example prompts (`list my Supabase projects`, `list my Supabase organizations`, `for organization <name>, list available regions`). The waiting dialog now uses centered built-in `DialogAlert` instead of a custom off-center shell. Browser success page stays minimal with a small prompt snippet. Dismissing the waiting dialog suppresses the success dialog to avoid surprise popups. Also fixes error dialog retry to start a fresh OAuth flow instead of reopening stale browser tabs.

  Refs: #22, #27

- 6271160: Fix inconsistent auth error messages between toast/dialog and browser/TUI by extracting a shared `formatAuthError` helper that unwraps nested SDK error payloads.
- c8e538b: Add `supabase_list_regions` tool — calls `GET /v1/projects/available-regions?organization_slug=<slug>` so the LLM can discover valid region codes before creating projects.

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
