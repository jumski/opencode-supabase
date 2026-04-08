import type { Plugin } from "@opencode-ai/plugin";

import { createSupabaseAuth } from "./auth.ts";
import { createSupabaseTools } from "./tools.ts";

const server: Plugin = async (input, options) => {
  return {
    auth: createSupabaseAuth(input, options),
    tool: createSupabaseTools(input, options),
  };
};

export default { id: "supabase", server };
