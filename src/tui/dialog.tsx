import type { TuiPluginApi } from "@opencode-ai/plugin/tui";

type SupabaseDialogProps = {
  api: TuiPluginApi;
  onClose: () => void;
};

export function SupabaseDialog(props: SupabaseDialogProps) {
  return (
    <props.api.ui.Dialog onClose={props.onClose}>
      <box flexDirection="column" padding={1} gap={1}>
        <text>Connect Supabase</text>
        <text>
          Supabase login will start here soon. This first phase only verifies that the external plugin installs
          cleanly and can open a dedicated /supabase dialog.
        </text>
        <text>Press Esc to close this dialog.</text>
      </box>
    </props.api.ui.Dialog>
  );
}
