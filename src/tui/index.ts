import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";

import { formatAuthError } from "../shared/auth-errors.ts";
import { type SupabaseLogger, createSupabaseLogger, createTuiLogWriter } from "../shared/log.ts";
import { createSupabaseCommand } from "./commands.ts";

const INITIAL_MESSAGE = "Open your browser to authorize OpenCode to access your Supabase account.";

type OAuthResponse<T> = { data?: T; error?: unknown };

async function openBrowser(url: string) {
  const open = await import("open");
  await open.default(url);
}

export async function runSupabaseAuth(
  api: TuiPluginApi,
  logger: SupabaseLogger,
  openUrl: (url: string) => Promise<void> = openBrowser,
  ownership: { isActive: () => boolean; cancel: () => void } = {
    isActive: () => true,
    cancel: () => api.ui.dialog.clear(),
  },
) {
  try {
    if (ownership.isActive()) api.ui.dialog.replace(() =>
      api.ui.DialogConfirm({
        title: "Connect to Supabase",
        message: "Waiting for browser authorization...",
        onConfirm: () => {},
        onCancel: ownership.cancel,
      }),
    );

    const response = (await api.client.provider.oauth.authorize({
      providerID: "supabase",
      method: 0,
    })) as OAuthResponse<{ url?: string; method?: string }>;
    if (response.error) throw new Error(formatAuthError("start", response.error));
    if (!response.data?.url) throw new Error("Invalid OAuth authorization response");

    const url = new URL(response.data.url).toString();
    if (ownership.isActive()) api.ui.dialog.replace(() =>
      api.ui.DialogConfirm({
        title: "Connect to Supabase",
        message: `Complete authorization in your browser.\n\n${url}`,
        onConfirm: () => {},
        onCancel: ownership.cancel,
      }),
    );
    if (response.data.method === "auto") {
      try {
        await openUrl(url);
      } catch (error) {
        await logger.warn("supabase browser open failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const callback = (await api.client.provider.oauth.callback({
      providerID: "supabase",
      method: 0,
    })) as OAuthResponse<boolean>;
    if (callback.error) throw new Error(formatAuthError("callback", callback.error));
    if (callback.data !== true) throw new Error("OAuth authorization was denied");

    if (!ownership.isActive()) return;
    api.ui.dialog.clear();
    api.ui.toast({ variant: "success", message: "Supabase account connected." });
  } catch (error) {
    const message = formatAuthError("unknown", error);
    await logger.error("supabase auth failed", { message });
    if (!ownership.isActive()) return;
    api.ui.dialog.clear();
    api.ui.toast({ variant: "error", message });
  }
}

const tui: TuiPlugin = async (api) => {
  const logger = createSupabaseLogger({ write: createTuiLogWriter(api.client) });
  let flowID = 0;

  api.command.register(() => [
    createSupabaseCommand(() => {
      const id = ++flowID;
      const cancel = () => {
        if (flowID !== id) return;
        flowID += 1;
        api.ui.dialog.clear();
      };
      api.ui.dialog.replace(() =>
        api.ui.DialogConfirm({
          title: "Connect your Supabase account",
          message: INITIAL_MESSAGE,
          onConfirm: () => runSupabaseAuth(api, logger, openBrowser, { isActive: () => flowID === id, cancel }),
          onCancel: cancel,
        }),
      );
    }),
  ]);
};

export default { id: "supabase", tui };
