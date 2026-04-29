---
"opencode-supabase": patch
---

## UI Improvements

- **Supabase auth progress**: Replaced static auth checks with an animated spinner dialog, markdown instructions, and clearer "No action needed" preflight copy.
- **OAuth dismiss behavior**: Renamed in-progress auth action to `Dismiss`. Dismiss closes only the dialog; browser approval can still complete auth and show the success toast.
- **Connection flow polish**: Unified "Connect to Supabase" titles, shortened browser approval copy, simplified post-auth onboarding, and replaced the success dialog with a single OK action.
