import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { BaseRenderable } from "@opentui/core";
import { createElement, insertNode, setProp } from "@opentui/solid";
import { createSignal } from "solid-js";

import { formatAuthError } from "../shared/auth-errors.ts";
import type { SupabaseLogger } from "../shared/log.ts";

type SupabaseDialogProps = {
  api: TuiPluginApi;
  onClose: () => void;
  logger: SupabaseLogger;
  initialState?: OAuthState;
  lifecycle?: {
    closed: boolean;
  };
};

type OAuthState =
  | { type: "idle" }
  | { type: "authorizing"; url: string }
  | { type: "waiting_callback"; url: string }
  | { type: "success" }
  | { type: "error"; message: string; url?: string };

type ApiResponse<T> = { data?: T; error?: unknown };

type AuthData = {
  url: string;
  instructions: string;
  method: string;
};

type AuthFlowContext = {
  api: TuiPluginApi;
  logger: SupabaseLogger;
  setState: (state: OAuthState) => void;
  onSuccess: () => void;
};

type WaitingDialogModel = {
  wrapper: {
    width: "100%";
    height: "100%";
    justifyContent: "center";
    alignItems: "center";
  };
  card: {
    title: string;
    dismissHint: string;
    url: string;
    instructions: string;
    autoCloseHint: string;
    waitingText: string;
    footerHints: [string];
  };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function renderable(tag: string, props: Record<string, unknown>, children: BaseRenderable[] = []) {
  const node = createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    setProp(node, key, value);
  }

  for (const child of children) {
    insertNode(node, child);
  }

  return node;
}

function text(content: string, props: Record<string, unknown> = {}) {
  return renderable("text", { ...props, content });
}

async function openBrowser(url: string, logger: SupabaseLogger) {
  try {
    const open = await import("open");
    await open.default(url);
  } catch (error) {
    await logger.warn("supabase browser open failed", {
      message: getErrorMessage(error),
    });
  }
}

export function waitingDialogModel(url: string): WaitingDialogModel {
  return {
    wrapper: {
      width: "100%",
      height: "100%",
      justifyContent: "center",
      alignItems: "center",
    },
    card: {
      title: "Connect Supabase",
      dismissHint: "esc",
      url,
      instructions: "Complete authorization in your browser.",
      autoCloseHint: "This window will close automatically.",
      waitingText: "Waiting for authorization...",
      footerHints: ["o open browser again"],
    },
  };
}

function waitingDialog(url: string, logger: SupabaseLogger) {
  const model = waitingDialogModel(url);

  return renderable(
    "box",
    {
      ...model.wrapper,
      flexDirection: "column",
      onKeyDown: (key: { name?: string }) => {
        if (key.name === "o" || key.name === "return") {
          void openBrowser(url, logger);
        }
      },
    },
    [
      renderable(
        "box",
        {
          flexDirection: "column",
          gap: 1,
          paddingX: 2,
          paddingY: 1,
          width: "80%",
          maxWidth: 80,
        },
        [
          renderable(
            "box",
            {
              flexDirection: "row",
              justifyContent: "space-between",
            },
            [text(model.card.title, { bold: true }), text(model.card.dismissHint, { fg: "#8b8b8b" })],
          ),
          renderable("text", {
            content: model.card.url,
            fg: "#3ECF8E",
            onMouseUp: () => {
              void openBrowser(url, logger);
            },
          }),
          text(model.card.instructions, { fg: "#8b8b8b" }),
          text(model.card.autoCloseHint, { fg: "#8b8b8b" }),
          text(model.card.waitingText, { fg: "#8b8b8b" }),
          renderable(
            "box",
            {
              flexDirection: "row",
              gap: 2,
            },
            [text(model.card.footerHints[0], { fg: "#8b8b8b" })],
          ),
        ],
      ),
    ],
  );
}

export async function runAuthFlow(context: AuthFlowContext) {
  let authURL: string | undefined;
  let completed = false;

  try {
    await context.logger.info("supabase auth started", {
      phase: "authorize",
    });
    context.setState({ type: "authorizing", url: "" });

    const authResponse = (await context.api.client.provider.oauth.authorize({
      providerID: "supabase",
      method: 0,
    })) as ApiResponse<AuthData>;

    if (authResponse.error) {
      throw new Error(formatAuthError("start", authResponse.error));
    }

    const authData = authResponse.data;
    if (!authData?.url) {
      throw new Error("Invalid OAuth authorization response");
    }

    const { url, method } = authData;
    authURL = url;
    const safeUrl = new URL(url);
    context.setState({ type: "authorizing", url });

    await context.logger.debug("supabase auth authorize response received", {
      method,
      url_origin: safeUrl.origin,
      url_path: safeUrl.pathname,
    });

    if (method === "auto") {
      await openBrowser(url, context.logger);
    }

    context.setState({ type: "waiting_callback", url });
    await context.logger.debug("supabase auth waiting for callback");

    const callbackResponse = (await context.api.client.provider.oauth.callback({
      providerID: "supabase",
      method: 0,
    })) as ApiResponse<boolean>;

    if (callbackResponse.error) {
      throw new Error(formatAuthError("callback", callbackResponse.error));
    }

    if (callbackResponse.data !== true) {
      throw new Error("OAuth authorization was denied");
    }

    await context.logger.info("supabase auth completed", {
      status: "success",
    });
    context.setState({ type: "success" });
    completed = true;
  } catch (error) {
    const message = formatAuthError("unknown", error);
    await context.logger.error("supabase auth failed", {
      message,
    });
    context.setState({ type: "error", message, url: authURL });
    return;
  }

  if (completed) {
    try {
      context.onSuccess();
    } catch (error) {
      await context.logger.error("supabase auth success handler failed", {
        message: getErrorMessage(error),
      });
    }
  }
}

export function SupabaseDialog(props: SupabaseDialogProps) {
  const lifecycle = props.lifecycle ?? { closed: false };
  const [state, setStateSignal] = createSignal<OAuthState>(props.initialState ?? { type: "idle" });

  const closeDialog = () => {
    lifecycle.closed = true;
    props.onClose();
  };

  const setState = (nextState: OAuthState) => {
    if (lifecycle.closed) {
      return;
    }

    setStateSignal(nextState);

    if (nextState.type === "success") {
      return;
    }

    props.api.ui.dialog.replace(() =>
      SupabaseDialog({
        ...props,
        initialState: nextState,
        lifecycle,
      }),
    );
  };

  const startOAuth = () =>
    runAuthFlow({
      api: props.api,
      logger: props.logger,
      setState,
      onSuccess: () => {
        props.api.ui.toast({
          variant: "success",
          message: "Connected to Supabase. Try asking: list my Supabase projects",
        });
        closeDialog();
      },
    });

  const currentState = state();

  if (currentState.type === "idle") {
    return props.api.ui.DialogConfirm({
      title: "Connect Supabase",
      message:
        "This will open a browser window to authorize OpenCode to access your Supabase account. Continue?",
      onConfirm: startOAuth,
      onCancel: closeDialog,
    });
  }

  if (currentState.type === "authorizing") {
    if (!currentState.url) {
      return props.api.ui.DialogAlert({
        title: "Connect Supabase",
        message: "Starting authorization...",
        onConfirm: closeDialog,
      });
    }

    return props.api.ui.Dialog({
      size: "large",
      onClose: closeDialog,
      children: waitingDialog(currentState.url, props.logger),
    });
  }

  if (currentState.type === "waiting_callback") {
    return props.api.ui.Dialog({
      size: "large",
      onClose: closeDialog,
      children: waitingDialog(currentState.url, props.logger),
    });
  }

  if (currentState.type === "error") {
    return props.api.ui.DialogConfirm({
      title: "Authorization Failed",
      message: currentState.url
        ? `${currentState.message}\n\nIf you need to retry manually, visit:\n${currentState.url}`
        : currentState.message,
      onConfirm: async () => {
        if (currentState.url) {
          await openBrowser(currentState.url, props.logger);
        }
        await startOAuth();
      },
      onCancel: closeDialog,
    });
  }

  return props.api.ui.DialogAlert({
    title: "Connected",
    message: "Successfully connected to Supabase.",
    onConfirm: closeDialog,
  });
}
