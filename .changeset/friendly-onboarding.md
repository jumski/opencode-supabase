---
"opencode-supabase": patch
---

## UI Improvements

- **Friendlier onboarding text**: Simplified post-auth chat onboarding message to be more concise and less formal.
- **Dismissed OAuth feedback**: Use a `Dismiss` action for in-progress OAuth. Dismissing closes only the dialog; browser approval can still complete auth and show the success toast.
- **Success dialog single OK button**: Changed success state from DialogConfirm (Cancel/Confirm) to DialogAlert (single OK) for cleaner UX.
