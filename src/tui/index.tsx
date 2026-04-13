import type { TuiPlugin } from "@opencode-ai/plugin/tui";

import { createSupabaseLogger, createTuiLogWriter } from "../shared/log.ts";
import { createSupabaseCommand } from "./commands";
import { SupabaseDialog } from "./dialog";

const tui: TuiPlugin = async (api) => {
  const logger = createSupabaseLogger({
    write: createTuiLogWriter(api.client),
  });

  api.command.register(() => [
    createSupabaseCommand(() => {
      api.ui.dialog.replace(() => SupabaseDialog({ api, logger, onClose: () => api.ui.dialog.clear() }));
    }),
  ]);
};

export default { id: "supabase", tui };
