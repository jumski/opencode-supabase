import type { TuiPlugin } from "@opencode-ai/plugin/tui";

import { createSupabaseCommand } from "./commands";
import { SupabaseDialog } from "./dialog";

const tui: TuiPlugin = async (api) => {
  api.command.register(() => [
    createSupabaseCommand(() => {
      api.ui.dialog.replace(() => SupabaseDialog({ api, onClose: () => api.ui.dialog.clear() }));
    }),
  ]);
};

export default { id: "supabase", tui };
