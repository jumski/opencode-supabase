import { expect, test } from "bun:test";

import serverModule from "../src/server/index.ts";
import { createSupabaseCommand } from "../src/tui/commands.ts";
import { SupabaseDialog } from "../src/tui/dialog.tsx";
import tuiModule from "../src/tui/index.tsx";

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
  let lastDialogState: string | undefined;

  await tuiModule.tui(
    {
      command: {
        register: (factory: () => Array<Record<string, unknown>>) => {
          commandsFactory = factory;
          return () => {};
        },
      },
      ui: {
        DialogAlert: (input: { title?: string; message?: string }) => {
          lastDialogState = "alert";
          return input;
        },
        DialogConfirm: (input: { title?: string; message?: string }) => {
          lastDialogState = "confirm";
          return input;
        },
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

  // The dialog starts in "idle" state and shows DialogConfirm
  const dialog = replaceFactory?.() as { title?: string; message?: string; onConfirm?: () => void; onCancel?: () => void } | undefined;
  expect(dialog?.title).toBe("Connect Supabase");
  expect(lastDialogState).toBe("confirm");
  expect(typeof dialog?.onConfirm).toBe("function");
  expect(typeof dialog?.onCancel).toBe("function");

  // Cancel should clear the dialog immediately
  dialog?.onCancel?.();
  expect(cleared).toBe(1);
});

test("supabase dialog treats boolean callback success as connected", async () => {
  const toasts: Array<{ variant?: string; message: string }> = [];
  let cleared = 0;

  const api = {
    ui: {
      DialogAlert: (input: unknown) => input,
      DialogConfirm: (input: unknown) => input,
      toast: (input: { variant?: string; message: string }) => {
        toasts.push(input);
      },
      dialog: {
        clear: () => {
          cleared += 1;
        },
      },
    },
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } }),
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  } as unknown as Parameters<typeof SupabaseDialog>[0]["api"];

  const logger = {
    debug: () => Promise.resolve(),
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
  };

  const dialog = SupabaseDialog({ api, logger, onClose: () => api.ui.dialog.clear() }) as {
    onConfirm?: () => Promise<void>;
  };

  await dialog.onConfirm?.();

  expect(toasts).toHaveLength(1);
  expect(toasts[0]).toMatchObject({
    variant: "success",
  });
  expect(cleared).toBe(1);
});

test("supabase dialog logs auth milestones without leaking oauth query values", async () => {
  const appLog = [] as Array<Record<string, unknown>>;
  let cleared = 0;

  const api = {
    ui: {
      DialogAlert: (input: unknown) => input,
      DialogConfirm: (input: unknown) => input,
      toast: () => {},
      dialog: {
        clear: () => {
          cleared += 1;
        },
      },
    },
    client: {
      app: {
        log: (input: Record<string, unknown>) => {
          appLog.push(input);
          return Promise.resolve(true);
        },
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth?code=secret", instructions: "Test", method: "auto" } }),
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  } as unknown as Parameters<typeof SupabaseDialog>[0]["api"];

  const logger = {
    debug: async (message: string, extra?: Record<string, unknown>) => {
      await api.client.app.log({ service: "opencode-supabase", level: "debug", message, extra });
    },
    info: async (message: string, extra?: Record<string, unknown>) => {
      await api.client.app.log({ service: "opencode-supabase", level: "info", message, extra });
    },
    warn: async (message: string, extra?: Record<string, unknown>) => {
      await api.client.app.log({ service: "opencode-supabase", level: "warn", message, extra });
    },
    error: async (message: string, extra?: Record<string, unknown>) => {
      await api.client.app.log({ service: "opencode-supabase", level: "error", message, extra });
    },
  };

  const dialog = SupabaseDialog({ api, logger, onClose: () => api.ui.dialog.clear() }) as {
    onConfirm?: () => Promise<void>;
  };

  await dialog.onConfirm?.();

  const serialized = JSON.stringify(appLog);
  expect(serialized).toContain("supabase auth started");
  expect(serialized).toContain("supabase auth completed");
  expect(serialized).not.toContain("code=secret");
  expect(cleared).toBe(1);
});

test("supabase dialog shows explicit callback port exhaustion toast", async () => {
  const toasts: Array<{ variant?: string; message: string }> = [];
  let cleared = 0;

  const api = {
    ui: {
      DialogAlert: (input: unknown) => input,
      DialogConfirm: (input: unknown) => input,
      toast: (input: { variant?: string; message: string }) => {
        toasts.push(input);
      },
      dialog: {
        clear: () => {
          cleared += 1;
        },
      },
    },
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({
            error: {
              message: "Supabase callback ports busy: 14589, 14590, 14591. Close other OpenCode sessions and retry.",
            },
          }),
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  } as unknown as Parameters<typeof SupabaseDialog>[0]["api"];

  const logger = {
    debug: () => Promise.resolve(),
    info: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    error: () => Promise.resolve(),
  };

  const dialog = SupabaseDialog({ api, logger, onClose: () => api.ui.dialog.clear() }) as {
    onConfirm?: () => Promise<void>;
  };

  await dialog.onConfirm?.();

  expect(toasts).toEqual([
    {
      variant: "error",
      message:
        "Supabase authorization failed: Supabase callback ports busy: 14589, 14590, 14591. Close other OpenCode sessions and retry.",
    },
  ]);
  expect(cleared).toBe(1);
});
