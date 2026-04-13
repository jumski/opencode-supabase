export type SupabaseLogLevel = "debug" | "info" | "warn" | "error";

export type SupabaseLogger = ReturnType<typeof createSupabaseLogger>;

type LogEntry = {
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
      await input.write({
        service: "opencode-supabase",
        level,
        message,
        extra,
      });
    } catch {}
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
