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

type DialogActionID = "connect" | "cancel" | "open_browser" | "list_projects" | "close" | "retry";

type DialogModel = {
  title: string;
  message: string;
  url?: string;
  status?: {
    label: string;
    tone: "warning" | "success" | "error";
  };
  actions: Array<{
    id: DialogActionID;
    label: string;
    description: string;
  }>;
};

type DialogModelOptions = {
  canSubmitPrompt?: boolean;
};

type DialogActionContext = {
  api: TuiPluginApi;
  logger: SupabaseLogger;
  onClose: () => void;
  startOAuth: () => Promise<void>;
  getState: () => OAuthState;
};

type AuthFlowContext = {
  api: TuiPluginApi;
  logger: SupabaseLogger;
  setState: (state: OAuthState) => void;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toneColor(tone: NonNullable<DialogModel["status"]>["tone"]) {
  if (tone === "success") {
    return "#3ECF8E";
  }

  if (tone === "error") {
    return "#ef4444";
  }

  return "#facc15";
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

async function ensureResultOk(result: { error?: unknown } | undefined) {
  if (result?.error) {
    throw new Error(formatAuthError("unknown", result.error));
  }
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

function canSubmitPrompt(api: TuiPluginApi) {
  const current = api.route.current;
  return current.name === "home" || current.name === "session";
}

export function buildDialogModel(state: OAuthState, options: DialogModelOptions = {}): DialogModel {
  const canRunPrompt = options.canSubmitPrompt ?? true;

  switch (state.type) {
    case "idle":
      return {
        title: "Connect Supabase",
        message: "Authorize OpenCode to access your Supabase account.",
        actions: [
          {
            id: "connect",
            label: "Connect Supabase",
            description: "Open the Supabase authorization flow.",
          },
          {
            id: "cancel",
            label: "Cancel",
            description: "Dismiss this dialog.",
          },
        ],
      };
    case "authorizing":
      return {
        title: "Connect Supabase",
        status: {
          label: "Authorizing",
          tone: "warning",
        },
        message: state.url
          ? "Opening your browser. If it does not open automatically, use the full URL below."
          : "Starting authorization...",
        url: state.url || undefined,
        actions: state.url
          ? [
              {
                id: "open_browser",
                label: "Open Browser Again",
                description: "Try opening the saved authorization URL again.",
              },
              {
                id: "cancel",
                label: "Cancel",
                description: "Dismiss this dialog.",
              },
            ]
          : [
              {
                id: "cancel",
                label: "Cancel",
                description: "Dismiss this dialog.",
              },
            ],
      };
    case "waiting_callback":
      return {
        title: "Connect Supabase",
        status: {
          label: "Authorizing",
          tone: "warning",
        },
        message: "Finish authorization in your browser. If needed, use the full URL below.",
        url: state.url,
        actions: [
          {
            id: "open_browser",
            label: "Open Browser Again",
            description: "Try opening the saved authorization URL again.",
          },
          {
            id: "cancel",
            label: "Cancel",
            description: "Dismiss this dialog.",
          },
        ],
      };
    case "success":
      return {
        title: "Connect Supabase",
        status: {
          label: "Connected",
          tone: "success",
        },
        message: canRunPrompt
          ? "Supabase is connected. Run a concrete example now or close this dialog."
          : "Supabase is connected. Return to a chat or home prompt to try example commands.",
        actions: canRunPrompt
          ? [
              {
                id: "list_projects",
                label: "List my Supabase projects",
                description: "Replace the current prompt with a project-listing command and run it.",
              },
              {
                id: "close",
                label: "Close",
                description: "Dismiss this dialog without running anything.",
              },
            ]
          : [
              {
                id: "close",
                label: "Close",
                description: "Dismiss this dialog.",
              },
            ],
      };
    case "error":
      return {
        title: "Connect Supabase",
        status: {
          label: "Authorization Failed",
          tone: "error",
        },
        message: state.message,
        url: state.url,
        actions: [
          {
            id: "retry",
            label: "Retry",
            description: "Restart Supabase authorization.",
          },
          ...(state.url
            ? [
                {
                  id: "open_browser" as const,
                  label: "Open Browser Again",
                  description: "Try reopening the saved authorization URL.",
                },
              ]
            : []),
          {
            id: "close",
            label: "Close",
            description: "Dismiss this dialog.",
          },
        ],
      };
  }
}

export async function runDialogAction(action: DialogActionID, context: DialogActionContext) {
  if (action === "cancel" || action === "close") {
    context.onClose();
    return;
  }

  if (action === "connect" || action === "retry") {
    await context.startOAuth();
    return;
  }

  if (action === "open_browser") {
    const currentState = context.getState();
    if (currentState.type === "authorizing" || currentState.type === "waiting_callback") {
      await openBrowser(currentState.url, context.logger);
    }

    if (currentState.type === "error" && currentState.url) {
      await openBrowser(currentState.url, context.logger);
    }
    return;
  }

  if (!canSubmitPrompt(context.api)) {
    throw new Error("Suggested prompt unavailable from this screen");
  }

  const clearResult = (await context.api.client.tui.clearPrompt()) as { error?: unknown };
  await ensureResultOk(clearResult);

  const appendResult = (await context.api.client.tui.appendPrompt({
    text: "list my Supabase projects",
  })) as { error?: unknown };
  await ensureResultOk(appendResult);

  const submitResult = (await context.api.client.tui.submitPrompt()) as { error?: unknown };
  await ensureResultOk(submitResult);
  context.onClose();
}

export async function runAuthFlow(context: AuthFlowContext) {
  let authURL: string | undefined;

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
  } catch (error) {
    const message = formatAuthError("unknown", error);
    await context.logger.error("supabase auth failed", {
      message,
    });
    context.setState({ type: "error", message, url: authURL });
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
    props.api.ui.dialog.replace(() =>
      SupabaseDialog({
        ...props,
        initialState: nextState,
        lifecycle,
      }),
    );
  };

  const startOAuth = () => runAuthFlow({ api: props.api, logger: props.logger, setState });

  const handleAction = async (action: DialogActionID) => {
    try {
      await runDialogAction(action, {
        api: props.api,
        logger: props.logger,
        onClose: closeDialog,
        startOAuth,
        getState: state,
      });
    } catch (error) {
      await props.logger.error("supabase dialog action failed", {
        action,
        message: getErrorMessage(error),
      });
      props.api.ui.toast({
        variant: "error",
        message: getErrorMessage(error),
      });
    }
  };

  const model = buildDialogModel(state(), {
    canSubmitPrompt: canSubmitPrompt(props.api),
  });

  const children: BaseRenderable[] = [text(model.title)];

  if (model.status) {
    children.push(
      renderable(
        "box",
        {
          border: true,
          borderColor: toneColor(model.status.tone),
          paddingX: 1,
          paddingY: 0,
        },
        [text(model.status.label, { fg: toneColor(model.status.tone) })],
      ),
    );
  }

  children.push(text(model.message));

  if (model.url) {
    children.push(
      renderable(
        "box",
        {
          border: true,
          borderColor: "#444444",
          padding: 1,
        },
        [renderable("scrollbox", { height: 3 }, [text(model.url)])],
      ),
    );
  }

  children.push(
    renderable("tab_select", {
      focused: true,
      showDescription: true,
      options: model.actions.map((action) => ({
        name: action.label,
        description: action.description,
        value: action.id,
      })),
      onSelect: (_index: number, option: { value?: string } | null) => {
        if (!option?.value) {
          return;
        }

        void handleAction(option.value as DialogActionID);
      },
    }),
  );

  return props.api.ui.Dialog({
    size: "large",
    onClose: closeDialog,
    children: renderable("box", { flexDirection: "column", gap: 1, padding: 1 }, children),
  });
}
