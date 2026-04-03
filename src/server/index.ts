import type { Plugin } from "@opencode-ai/plugin";

const server: Plugin = async () => {
  return {
    auth: undefined,
    tool: undefined,
  };
};

export default { id: "supabase", server };
