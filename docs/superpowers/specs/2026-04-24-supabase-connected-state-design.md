# `/supabase` Connected-State Preflight Design

## Summary

When a user runs `/supabase`, the dialog should first determine whether usable Supabase auth already exists. Users who are already connected should see that state immediately instead of being pushed back through the first-run OAuth flow.

This design keeps auth truth on the server side, reuses the existing saved-auth and refresh policy, and adds explicit UI for three outcomes: connected, disconnected, and unknown.

## Goals

- Show a clear connected state for users who already have usable auth.
- Reuse the same freshness and refresh semantics already used by tool execution.
- Provide visible feedback when the dialog needs to refresh auth.
- Handle broker and network failures without incorrectly forcing a disconnect.
- Keep the implementation minimal and aligned with current TUI patterns.

## Non-Goals

- Force a refresh on every `/supabase` open.
- Make a Supabase Management API call on every `/supabase` open.
- Detect remote revocation for still-fresh access tokens.
- Add a separate `/supabase-disconnect` command.
- Change the existing OAuth authorize/callback contract into a generic status API.

## Connected-State Semantics

The dialog should classify auth into one of three states.

### Connected

A user is connected when saved auth exists and one of these is true:

- the saved access token is still fresh under the same policy used by `ensureSupabaseToolAuth(...)`
- the access token is stale but refresh succeeds

### Disconnected

A user is disconnected when one of these is true:

- no saved auth exists
- refresh returns unauthorized (`400` or `401`) and the existing cleanup path clears local auth

### Unknown

A user is in an unknown state when saved auth exists but verification cannot complete because the broker or network is unavailable.

This preserves an important distinction: failure to verify is not the same thing as confirmed disconnection.

## User Experience

When `/supabase` opens, the dialog should run an auth preflight before showing the current connect confirmation.

The preflight has three outcomes:

- `connected`: show `Already connected to Supabase` with actions `Disconnect` and `Continue`
- `disconnected`: show the existing connect confirmation dialog
- `unknown`: show `Saved Supabase login found, but couldn't verify it right now.` with actions `Retry`, `Continue`, and `Disconnect`

Action semantics:

- `Continue` from `already_connected` closes the dialog and leaves the current saved auth untouched.
- `Retry` from `unknown` reruns the auth preflight.
- `Continue` from `unknown` closes the dialog, leaves saved auth untouched, and lets later tool execution determine whether auth is still usable.

## Loading Feedback

If the preflight completes from the saved auth state without needing a refresh, the dialog should not show an extra loading step.

If the preflight needs a refresh, the dialog should temporarily show a built-in alert with copy such as `Checking Supabase connection...`.

This loading state should reuse the existing centered `DialogAlert` pattern already used by the dialog's waiting states rather than introducing a custom dialog shell.

## Architecture

Auth-state truth must remain server-side. The TUI must not inspect `.opencode/supabase-auth.json` directly.

The implementation should add a small server-side auth-status helper that reuses the same store resolution and refresh policy as `ensureSupabaseToolAuth(...)`. That helper should return one of three outcomes:

- `connected`
- `disconnected`
- `unknown`

The existing OAuth `authorize()` and `callback()` contract should remain focused on starting interactive OAuth and should not be overloaded with connected-state detection.

## Proposed Component Changes

### TUI

`src/tui/dialog.tsx` should add three dialog states:

- `checking_auth`
- `already_connected`
- `unknown_auth`

The `checking_auth` state exists only for the refresh path and should not appear for fast local decisions.

The dialog flow should become:

1. Start auth preflight when `/supabase` opens.
2. If saved auth is fresh, show `already_connected`.
3. If saved auth requires refresh, show `checking_auth` while verification runs.
4. If refresh succeeds, show `already_connected`.
5. If no saved auth exists, show the existing connect dialog.
6. If refresh returns unauthorized, clear auth through the existing path and show the disconnected connect dialog.
7. If refresh cannot complete because of broker or network failure, show `unknown_auth`.

### Server

The server should expose a small helper that evaluates current auth status using existing store and refresh behavior.

This helper should:

1. Read saved auth using the current store-path resolution logic.
2. Return `disconnected` when saved auth does not exist.
3. Return `connected` when saved auth exists and is still fresh.
4. Attempt refresh when saved auth is present but stale.
5. Return `connected` after a successful refresh.
6. Return `disconnected` after unauthorized refresh and existing cleanup.
7. Return `unknown` for broker or network refresh failures that do not prove disconnection.

Relevant files:

- `src/tui/dialog.tsx`
- `src/server/tools.ts`
- `src/server/store.ts`

## Disconnect Behavior

Choosing `Disconnect` from either `already_connected` or `unknown_auth` should clear the locally saved auth through the existing server-side clear path, then return the user to the disconnected connect state.

Disconnect does not revoke Supabase credentials remotely. It only forgets the local saved auth used by the plugin.

## Error Handling and Accepted Limitations

The preflight must reuse the existing store path resolution so worktree and session scoping remain correct.

Unauthorized refresh should be treated as `disconnected`, not `unknown`.

Broker or network failures during refresh should be treated as `unknown`, not `disconnected`.

A fresh-but-remotely-revoked access token may still appear connected until the next real API call or the next refresh window. This is an accepted limitation for this iteration.

Host auth and local saved auth can still drift because host sync and cleanup are best-effort today. This design does not change that behavior.

## Testing Expectations

Add automated coverage for these cases:

- `/supabase` shows the current connect dialog when no saved auth exists
- `/supabase` shows `Already connected` when saved auth is still fresh
- `/supabase` shows `Checking Supabase connection...` while a refresh is in flight
- `/supabase` shows `Already connected` after a successful refresh
- `/supabase` shows the connect dialog after unauthorized refresh clears auth
- `/supabase` shows the unknown-state dialog after broker or network refresh failure
- `Disconnect` clears saved auth and returns the dialog to the disconnected flow
- store path resolution still targets the correct `.opencode/supabase-auth.json` location

## Rationale

This design uses the same definition of usable auth that tool execution already trusts. That keeps the `/supabase` UI aligned with actual runtime behavior instead of inventing a second auth policy inside the TUI.

Not forcing refresh on every `/supabase` open avoids unnecessary latency, extra broker dependence, ambiguous offline failures, and token churn when the current access token is already good enough.
