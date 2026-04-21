import { expect, test } from "bun:test";

import { HTML_SUCCESS } from "../src/server/auth-html.ts";
import serverModule from "../src/server/index.ts";
import { createSupabaseCommand } from "../src/tui/commands.ts";
import { buildDialogModel, runAuthFlow, runDialogAction } from "../src/tui/dialog.tsx";
import tuiModule from "../src/tui/index.tsx";

type LogEntry = Record<string, unknown>;

function createLogger(logs?: LogEntry[]) {
  if (!logs) {
    return {
      debug: () => Promise.resolve(),
      info: () => Promise.resolve(),
      warn: () => Promise.resolve(),
      error: () => Promise.resolve(),
    };
  }

  return {
    debug: async (message: string, extra?: Record<string, unknown>) => {
      logs.push({ level: "debug", message, extra });
    },
    info: async (message: string, extra?: Record<string, unknown>) => {
      logs.push({ level: "info", message, extra });
    },
    warn: async (message: string, extra?: Record<string, unknown>) => {
      logs.push({ level: "warn", message, extra });
    },
    error: async (message: string, extra?: Record<string, unknown>) => {
      logs.push({ level: "error", message, extra });
    },
  };
}

function createDialogApi(overrides?: Record<string, unknown>) {
  let cleared = 0;
  let replaced = 0;
  const dialogs: unknown[] = [];
  const toasts: Array<{ variant?: string; message: string }> = [];
  const promptOps: Array<{ op: string; payload?: unknown }> = [];
  let openCalls: string[] = [];

  const api = {
    route: {
      current: {
        name: "home",
      },
    },
    ui: {
      Dialog: (input: unknown) => {
        dialogs.push(input);
        return input;
      },
      DialogAlert: (input: unknown) => input,
      DialogConfirm: (input: unknown) => input,
      toast: (input: { variant?: string; message: string }) => {
        toasts.push(input);
      },
      dialog: {
        replace: () => {
          replaced += 1;
        },
        clear: () => {
          cleared += 1;
        },
      },
    },
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => {
          promptOps.push({ op: "clearPrompt" });
          return Promise.resolve({ data: true });
        },
        appendPrompt: (input: unknown) => {
          promptOps.push({ op: "appendPrompt", payload: input });
          return Promise.resolve({ data: true });
        },
        submitPrompt: () => {
          promptOps.push({ op: "submitPrompt" });
          return Promise.resolve({ data: true });
        },
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } }),
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
    __test: {
      dialogs,
      toasts,
      promptOps,
      get cleared() {
        return cleared;
      },
      get replaced() {
        return replaced;
      },
      get openCalls() {
        return openCalls;
      },
      set openCalls(value: string[]) {
        openCalls = value;
      },
    },
  };

  return Object.assign(api, overrides) as typeof api & {
    __test: {
      dialogs: unknown[];
      toasts: Array<{ variant?: string; message: string }>;
      promptOps: Array<{ op: string; payload?: unknown }>;
      cleared: number;
      replaced: number;
      openCalls: string[];
    };
  };
}

test("server plugin exports supabase id and server hook", () => {
  expect(serverModule.id).toBe("supabase");
  expect(typeof serverModule.server).toBe("function");
});

test("supabase command exposes the expected slash metadata", () => {
  let opened = 0;

  const command = createSupabaseCommand(() => {
    opened += 1;
  });

  expect(command?.title).toBe("Connect Supabase");
  expect(command?.value).toBe("supabase.connect");
  expect(command?.slash).toEqual({ name: "supabase" });

  const onSelect = command?.onSelect as (() => void) | undefined;
  expect(typeof onSelect).toBe("function");
  onSelect?.();
  expect(opened).toBe(1);
});

test("tui plugin registers /supabase and opens a closable dialog", async () => {
  let commandsFactory: (() => Array<Record<string, unknown>>) | undefined;
  let replaceFactory: (() => unknown) | undefined;
  let cleared = 0;
  let usedCustomDialog = false;

  await tuiModule.tui(
    {
      command: {
        register: (factory: () => Array<Record<string, unknown>>) => {
          commandsFactory = factory;
          return () => {};
        },
      },
      ui: {
        Dialog: (input: unknown) => {
          usedCustomDialog = true;
          return input;
        },
        DialogAlert: (input: unknown) => input,
        DialogConfirm: (input: unknown) => input,
        dialog: {
          replace: (factory: () => unknown) => {
            replaceFactory = factory;
          },
          clear: () => {
            cleared += 1;
          },
        },
        toast: () => {},
      },
      client: {
        provider: {
          oauth: {
            authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "auto" } }),
            callback: () => Promise.resolve({ data: true }),
          },
        },
      },
    } as never,
    undefined,
    {} as never,
  );

  expect(typeof commandsFactory).toBe("function");

  const commands = commandsFactory?.();
  expect(commands).toHaveLength(1);

  const command = commands?.[0] as { slash?: { name?: string }; onSelect?: () => void } | undefined;
  expect(command?.slash?.name).toBe("supabase");

  command?.onSelect?.();
  expect(typeof replaceFactory).toBe("function");

  expect(typeof replaceFactory).toBe("function");
  expect(usedCustomDialog).toBe(false);
  expect(cleared).toBe(0);
});

test("dialog model describes idle, waiting, success, and error actions", () => {
  expect(buildDialogModel({ type: "idle" })).toMatchObject({
    title: "Connect Supabase",
    actions: [
      { id: "connect", label: "Connect Supabase" },
      { id: "cancel", label: "Cancel" },
    ],
  });

  expect(buildDialogModel({ type: "waiting_callback", url: "https://example.com/auth" })).toMatchObject({
    status: { label: "Authorizing", tone: "warning" },
    url: "https://example.com/auth",
    actions: [
      { id: "open_browser", label: "Open Browser Again" },
      { id: "cancel", label: "Cancel" },
    ],
  });

  expect(buildDialogModel({ type: "success" })).toMatchObject({
    status: { label: "Connected", tone: "success" },
    actions: [
      { id: "list_projects", label: "List my Supabase projects" },
      { id: "close", label: "Close" },
    ],
  });

  expect(buildDialogModel({ type: "success" }, { canSubmitPrompt: false })).toMatchObject({
    status: { label: "Connected", tone: "success" },
    actions: [{ id: "close", label: "Close" }],
  });

  expect(buildDialogModel({ type: "error", message: "bad auth", url: "https://example.com/auth" })).toMatchObject({
    status: { label: "Authorization Failed", tone: "error" },
    url: "https://example.com/auth",
    actions: [
      { id: "retry", label: "Retry" },
      { id: "open_browser", label: "Open Browser Again" },
      { id: "close", label: "Close" },
    ],
  });
});

test("supabase dialog success keeps dialog open and removes durable chat writes", async () => {
  const states: Array<Record<string, unknown>> = [];
  let promptCalls = 0;
  const api = createDialogApi({
    route: {
      current: {
        name: "session",
        params: {
          sessionID: "session-123",
        },
      },
    },
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => {
          promptCalls += 1;
          return Promise.resolve({ data: true });
        },
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } }),
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  await runAuthFlow({
    api: api as never,
    logger: createLogger(),
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  expect(api.__test.toasts).toEqual([]);
  expect(api.__test.cleared).toBe(0);
  expect(promptCalls).toBe(0);
  expect(states.at(-1)).toEqual({ type: "success" });
});

test("supabase dialog success action clears, appends, submits, then closes", async () => {
  const api = createDialogApi();
  const logger = createLogger();

  await runDialogAction("list_projects", {
    api: api as never,
    logger,
    onClose: () => api.ui.dialog.clear(),
    startOAuth: () => Promise.resolve(),
    getState: () => ({ type: "success" }),
  });

  expect(api.__test.promptOps).toEqual([
    { op: "clearPrompt" },
    { op: "appendPrompt", payload: { text: "list my Supabase projects" } },
    { op: "submitPrompt" },
  ]);
  expect(api.__test.cleared).toBe(1);
});

test("supabase dialog error keeps url and offers recoverable actions", async () => {
  const states: Array<Record<string, unknown>> = [];
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } }),
          callback: () => Promise.resolve({
            error: {
              data: {
                name: "UnknownError",
                data: {
                  message: "broker returned an invalid response",
                },
              },
              errors: [],
              success: false,
            },
          }),
        },
      },
    },
  });

  await runAuthFlow({
    api: api as never,
    logger: createLogger(),
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  expect(api.__test.toasts).toEqual([]);
  expect(api.__test.cleared).toBe(0);
  expect(states.at(-1)).toEqual({
    type: "error",
    message: "broker returned an invalid response",
    url: "https://example.com/auth",
  });

  const model = buildDialogModel({
    type: "error",
    message: "broker returned an invalid response",
    url: "https://example.com/auth",
  });

  expect(model.url).toBe("https://example.com/auth");
  expect(model.actions.map((action) => action.id)).toEqual(["retry", "open_browser", "close"]);
});

test("auth success html is minimal handoff copy", () => {
  expect(HTML_SUCCESS).toContain("Authorization Successful");
  expect(HTML_SUCCESS).toContain("You can <strong>close this window</strong> and return to OpenCode.");
  expect(HTML_SUCCESS).not.toContain("list my Supabase projects");
});

test("supabase dialog logs auth milestones without leaking oauth query values", async () => {
  const logs: LogEntry[] = [];
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth?code=secret", instructions: "Test", method: "auto" } }),
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  await runAuthFlow({
    api: api as never,
    logger: createLogger(logs),
    setState: () => {},
  });

  const serialized = JSON.stringify(logs);
  expect(serialized).toContain("supabase auth started");
  expect(serialized).toContain("supabase auth completed");
  expect(serialized).not.toContain("code=secret");
});
