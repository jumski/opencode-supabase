import type { Plugin } from "@opencode-ai/plugin";

import { createSupabaseAuth } from "./auth.ts";

const server: Plugin = async (input, options) => {
  return {
    auth: createSupabaseAuth(input, options),
    tool: undefined,
  };
};

export default { id: "supabase", server };
