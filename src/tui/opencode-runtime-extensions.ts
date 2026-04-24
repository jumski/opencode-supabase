// OpenCode host supports `label` on DialogConfirm since ~Mar 2026
// (commit e2d03ce38 in opencode repo: interactive update flow for non-patch releases).
// The @opencode-ai/plugin SDK types (up to 1.14.24) never declared it.
// This module patches the gap locally until the SDK catches up.

import type { TuiDialogConfirmProps } from "@opencode-ai/plugin/tui";

export type DialogConfirmWithLabel = TuiDialogConfirmProps & {
  label?: string;
};
