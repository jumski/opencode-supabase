import type { Plugin } from "@opencode-ai/plugin";

import { createServerLogWriter, createSupabaseLogger } from "../shared/log.ts";
import { createSupabaseAuth } from "./auth.ts";
import { createSupabaseTools } from "./tools.ts";

const server: Plugin = async (input, options) => {
  const logger = createSupabaseLogger({
    write: createServerLogWriter(input.client),
  });

  return {
    auth: createSupabaseAuth(input, options, { logger }),
    tool: createSupabaseTools(input, options, { logger }),
  };
};

export default { id: "supabase", server };
