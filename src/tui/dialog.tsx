import type { TuiPluginApi } from "@opencode-ai/plugin/tui";

type SupabaseDialogProps = {
  api: TuiPluginApi;
  onClose: () => void;
};

export function SupabaseDialog(props: SupabaseDialogProps) {
  return props.api.ui.DialogAlert({
    title: "Connect Supabase",
    message:
      "Supabase login will start here soon. This first phase only verifies that the external plugin installs cleanly and can open a dedicated /supabase dialog.",
    onConfirm: props.onClose,
  });
}
