---
"opencode-supabase": minor
---

## Features

- **Connected-state detection**: `/supabase` now checks saved auth before showing the connect dialog. If already connected, shows "Already connected to Supabase" with options to continue or disconnect.
- **Disconnect action**: Added ability to disconnect from Supabase via the already-connected dialog.
- **Auth status preflight**: Dialog now shows "Checking Supabase connection..." while verifying auth state.

## Fixes

- **Preflight deduplication**: Prevent duplicate auth status checks when dialog re-renders.
- **Broker refresh single-flight**: Concurrent stale-auth callers now join one broker refresh instead of spawning multiple.
- **Disconnect race protection**: Explicit disconnect wins over in-flight refresh operations.
- **Stale refresh handling**: Refreshes that complete after newer auth is written no longer overwrite or clear the newer credentials.

## UI Improvements

- **Disconnect label**: Already-connected dialog cancel button now explicitly labeled "Disconnect" instead of generic "Cancel".
