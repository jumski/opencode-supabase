import { expect, test } from "bun:test";

import { createSupabaseCommand } from "../src/tui/commands.ts";
import serverModule from "../src/server/index.ts";
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
            callback: () => Promise.resolve({ data: { type: "success" } }),
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
