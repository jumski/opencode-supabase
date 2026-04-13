import type { Plugin } from "@opencode-ai/plugin";

import { createSupabaseLogger } from "../shared/log.ts";
import { createSupabaseAuth } from "./auth.ts";
import { createSupabaseTools } from "./tools.ts";

const server: Plugin = async (input, options) => {
  const logger = createSupabaseLogger({
    write: (entry) => input.client.app.log(entry as any),
  });

  return {
    auth: createSupabaseAuth(input, options, { logger }),
    tool: createSupabaseTools(input, options, { logger }),
  };
};

export default { id: "supabase", server };
