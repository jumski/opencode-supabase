import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
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
    dismissed?: boolean;
  };
};

type OAuthState =
  | { type: "checking_auth" }
  | { type: "idle" }
  | { type: "already_connected" }
  | { type: "authorizing"; url: string }
  | { type: "waiting_callback"; url: string }
  | { type: "success" }
  | { type: "unknown"; message: string }
  | { type: "error"; message: string; url?: string };

type ApiResponse<T> = { data?: T; error?: unknown };

type AuthData = {
  url: string;
  instructions: string;
  method: string;
};

type AuthStatus =
  | { status: "connected"; checked: boolean }
  | { status: "disconnected"; checked: boolean }
  | { status: "refresh_required"; checked: true };

type AuthFlowContext = {
  api: TuiPluginApi;
  logger: SupabaseLogger;
  setState: (state: OAuthState) => void;
  onSuccess: () => void;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseAuthStatus(instructions: string): AuthStatus {
  const parsed = JSON.parse(instructions) as Partial<AuthStatus>;
  if (
    parsed.status === "connected" ||
    parsed.status === "disconnected" ||
    parsed.status === "refresh_required"
  ) {
    return parsed as AuthStatus;
  }

  throw new Error("Invalid Supabase auth status response");
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

export async function runAuthPreflight(context: Pick<AuthFlowContext, "api" | "logger" | "setState">) {
  context.setState({ type: "checking_auth" });

  try {
    const authResponse = (await context.api.client.provider.oauth.authorize({
      providerID: "supabase",
      method: 1,
    })) as ApiResponse<AuthData>;

    if (authResponse.error) {
      throw new Error(formatAuthError("start", authResponse.error));
    }

    const instructions = authResponse.data?.instructions;
    if (!instructions) {
      throw new Error("Invalid Supabase auth status response");
    }

    const status = parseAuthStatus(instructions);
    if (status.status === "connected") {
      context.setState({ type: "already_connected" });
      return;
    }

    if (status.status === "disconnected") {
      context.setState({ type: "idle" });
      return;
    }

    const callbackResponse = (await context.api.client.provider.oauth.callback({
      providerID: "supabase",
      method: 1,
    })) as ApiResponse<boolean>;

    if (callbackResponse.error) {
      throw new Error(formatAuthError("callback", callbackResponse.error));
    }

    if (callbackResponse.data === true) {
      context.setState({ type: "already_connected" });
      return;
    }

    context.setState({ type: "idle" });
  } catch (error) {
    context.setState({
      type: "unknown",
      message: formatAuthError("unknown", error),
    });
  }
}

export function SupabaseDialog(props: SupabaseDialogProps) {
  const lifecycle = props.lifecycle ?? { closed: false };
  const [state, setStateSignal] = createSignal<OAuthState>(props.initialState ?? { type: "checking_auth" });

  const closeDialog = (dismissed = false) => {
    lifecycle.closed = true;
    if (dismissed) {
      lifecycle.dismissed = true;
    }
    props.onClose();
  };

  const setState = (nextState: OAuthState) => {
    if (lifecycle.closed) {
      return;
    }

    setStateSignal(nextState);

    if (nextState.type === "success") {
      if (lifecycle.dismissed) {
        // User dismissed waiting dialog; stay silent
        return;
      }
      props.api.ui.dialog.replace(() =>
        SupabaseDialog({
          ...props,
          initialState: nextState,
          lifecycle,
        }),
      );
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
        // Success dialog handles user-facing confirmation
      },
    });

  const retryPreflight = () =>
    runAuthPreflight({
      api: props.api,
      logger: props.logger,
      setState,
    });

  const disconnect = async () => {
    try {
      await props.api.client.provider.oauth.authorize({
        providerID: "supabase",
        method: 1,
        inputs: { action: "disconnect" },
      });
    } catch (error) {
      await props.logger.warn("supabase disconnect failed", {
        message: getErrorMessage(error),
      });
    }
    closeDialog();
  };

  const currentState = state();

  if (currentState.type === "checking_auth") {
    queueMicrotask(() => {
      if (lifecycle.closed) {
        return;
      }
      void retryPreflight();
    });

    return props.api.ui.DialogAlert({
      title: "Connect Supabase",
      message: "Checking Supabase connection...",
      onConfirm: () => closeDialog(true),
    });
  }

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
      onConfirm: () => closeDialog(true),
    });
    }

    return props.api.ui.DialogAlert({
      title: "Connect Supabase",
      message: `Complete authorization in your browser.\n\nIf the browser did not open, visit:\n${currentState.url}\n\nWaiting for authorization...`,
      onConfirm: () => closeDialog(true),
    });
  }

  if (currentState.type === "waiting_callback") {
    return props.api.ui.DialogAlert({
      title: "Connect Supabase",
      message: `Complete authorization in your browser.\n\nIf the browser did not open, visit:\n${currentState.url}\n\nWaiting for authorization...`,
      onConfirm: () => closeDialog(true),
    });
  }

  if (currentState.type === "error") {
    return props.api.ui.DialogConfirm({
      title: "Authorization Failed",
      message: currentState.url
        ? `${currentState.message}\n\nIf you need to retry manually, visit:\n${currentState.url}`
        : currentState.message,
      onConfirm: async () => {
        await startOAuth();
      },
      onCancel: closeDialog,
    });
  }

  if (currentState.type === "already_connected") {
    return props.api.ui.DialogConfirm({
      title: "Already connected to Supabase",
      message: "Your saved Supabase login is ready to use. Continue to close this dialog, or cancel to disconnect.",
      onConfirm: closeDialog,
      onCancel: disconnect,
    });
  }

  if (currentState.type === "unknown") {
    return props.api.ui.DialogConfirm({
      title: "Supabase connection status unknown",
      message: `${currentState.message}\n\nConfirm to retry, or cancel to continue without changing saved auth.`,
      onConfirm: retryPreflight,
      onCancel: closeDialog,
    });
  }

  return props.api.ui.DialogConfirm({
    title: "Connected to Supabase",
    message:
      "Your account is ready. Try asking:\n\n  list my Supabase projects\n  list my Supabase organizations\n  for organization <name>, list available regions\n\nRun an example?",
    onConfirm: async () => {
      try {
        await props.api.client.tui.appendPrompt({
          text: "list my Supabase projects",
        });
      } catch (error) {
        await props.logger.warn("supabase append prompt failed", {
          message: getErrorMessage(error),
        });
      }
      closeDialog();
    },
    onCancel: closeDialog,
  });
}
