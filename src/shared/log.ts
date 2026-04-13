export type SupabaseLogLevel = "debug" | "info" | "warn" | "error";

export type SupabaseLogger = ReturnType<typeof createSupabaseLogger>;

export type LogEntry = {
  service: string;
  level: SupabaseLogLevel;
  message: string;
  extra?: Record<string, unknown>;
};

type LogWriter = (entry: LogEntry) => Promise<unknown>;

export function createSupabaseLogger(input: { write: LogWriter }) {
  async function emit(
    level: SupabaseLogLevel,
    message: string,
    extra?: Record<string, unknown>,
  ) {
    try {
      const result = await input.write({
        service: "opencode-supabase",
        level,
        message,
        extra,
      });
      if (result && typeof result === "object" && "error" in result) {
        console.error("[opencode-supabase] host log rejected:", (result as { error: unknown }).error);
      }
    } catch (error) {
      console.error("[opencode-supabase] host log failed:", error instanceof Error ? error.message : error);
    }
  }

  return {
    debug(message: string, extra?: Record<string, unknown>) {
      return emit("debug", message, extra);
    },
    info(message: string, extra?: Record<string, unknown>) {
      return emit("info", message, extra);
    },
    warn(message: string, extra?: Record<string, unknown>) {
      return emit("warn", message, extra);
    },
    error(message: string, extra?: Record<string, unknown>) {
      return emit("error", message, extra);
    },
  };
}

export function createServerLogWriter(client: { app: { log: (input: { body: LogEntry }) => Promise<unknown> } }) {
  return (entry: LogEntry) => client.app.log({ body: entry });
}

export function createTuiLogWriter(client: { app: { log: (input: LogEntry, options?: { throwOnError?: boolean }) => Promise<unknown> } }) {
  return (entry: LogEntry) => client.app.log(entry, { throwOnError: true });
}
