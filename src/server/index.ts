import type { Plugin } from "@opencode-ai/plugin";

import { createServerLogWriter, createSupabaseLogger } from "../shared/log.ts";
import { createSupabaseAuth } from "./auth.ts";
import { registerSupabaseSkillPaths } from "./skills.ts";
import { createSupabaseTools } from "./tools.ts";

const server: Plugin = async (input, options) => {
  const logger = createSupabaseLogger({
    write: createServerLogWriter(input.client),
  });

  return {
    config: async (config) => {
      registerSupabaseSkillPaths(config, options, {
        warn: (message, data) => logger.warn(message, data as Record<string, unknown>),
      });
    },
    auth: createSupabaseAuth(input, options, { logger }),
    tool: createSupabaseTools(input, options, { logger }),
  };
};

export default { id: "supabase", server };
