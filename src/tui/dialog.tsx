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
    preflightPromise?: Promise<void>;
    onboardingPromptSent?: boolean;
    chatSessionID?: string;
  };
};

const ONBOARDING_MESSAGE = `Supabase is connected.

You can ask me about:
- your organizations and projects
- API keys for a project
- available database regions
- creating a new project

Try this:
list my Supabase projects`;

const onboardedSessionIDsByApi = new WeakMap<TuiPluginApi, Set<string>>();

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
  onSuccess: () => void | Promise<void>;
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

async function ensureChatSession(api: TuiPluginApi) {
  const currentRoute = api.route.current;
  let sessionID =
    currentRoute.name === "session" ? (currentRoute.params as { sessionID?: string } | undefined)?.sessionID : undefined;

  if (!sessionID && currentRoute.name === "home") {
    const response = await api.client.session.create({});
    sessionID = (response.data as { id?: string } | undefined)?.id;
    if (sessionID) {
      api.route.navigate("session", { sessionID });
    }
  }

  return sessionID;
}

async function injectOnboardingPrompt(
  api: TuiPluginApi,
  logger: SupabaseLogger,
  lifecycle: NonNullable<SupabaseDialogProps["lifecycle"]>,
) {
  if (lifecycle.onboardingPromptSent) {
    return;
  }

  if (!lifecycle.chatSessionID) {
    await logger.warn("supabase onboarding prompt skipped", {
      reason: "missing_session",
    });
    return;
  }

  const sessionID = lifecycle.chatSessionID;
  const onboardedSessionIDs = onboardedSessionIDsByApi.get(api) ?? new Set<string>();
  onboardedSessionIDsByApi.set(api, onboardedSessionIDs);

  if (onboardedSessionIDs.has(sessionID)) {
    lifecycle.onboardingPromptSent = true;
    return;
  }

  lifecycle.onboardingPromptSent = true;
  onboardedSessionIDs.add(sessionID);

  try {
    await api.client.session.promptAsync({
      sessionID,
      noReply: true,
      parts: [
        {
          type: "text",
          text: ONBOARDING_MESSAGE,
          ignored: true,
        },
      ],
    });
  } catch (error) {
    lifecycle.onboardingPromptSent = false;
    onboardedSessionIDs.delete(sessionID);
    await logger.warn("supabase onboarding prompt failed", {
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
      await context.onSuccess();
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

  const startOAuth = async () => {
    if (!lifecycle.chatSessionID) {
      lifecycle.chatSessionID = await ensureChatSession(props.api);
    }
    return runAuthFlow({
      api: props.api,
      logger: props.logger,
      setState,
      onSuccess: () => {
        if (lifecycle.closed || lifecycle.dismissed) {
          return;
        }

        return injectOnboardingPrompt(props.api, props.logger, lifecycle);
      },
    });
  };

  const retryPreflight = () => {
    if (lifecycle.preflightPromise) {
      return lifecycle.preflightPromise;
    }

    lifecycle.preflightPromise = runAuthPreflight({
      api: props.api,
      logger: props.logger,
      setState,
    }).finally(() => {
      lifecycle.preflightPromise = undefined;
    });

    return lifecycle.preflightPromise;
  };

  const disconnect = async () => {
    try {
      await props.api.client.provider.oauth.authorize({
        providerID: "supabase",
        method: 1,
        inputs: { action: "disconnect" },
      });
      props.api.ui.toast({ message: "Disconnected from Supabase" });
      closeDialog();
    } catch (error) {
      await props.logger.warn("supabase disconnect failed", {
        message: getErrorMessage(error),
      });
      setState({
        type: "unknown",
        message: `Couldn't disconnect from Supabase right now. ${formatAuthError("unknown", error)}`,
      });
    }
  };

  const currentState = state();

  if (currentState.type === "checking_auth") {
    queueMicrotask(() => {
      if (lifecycle.closed || lifecycle.preflightPromise) {
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
      title: "Connect your Supabase account",
      message: "Opens your browser to authorize OpenCode to access your Supabase account.",
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
      title: "Connect to Supabase",
      message: `Complete authorization in your browser.\n\nIf the browser did not open, visit:\n${currentState.url}\n\nWaiting for authorization...`,
      onConfirm: () => closeDialog(true),
    });
  }

  if (currentState.type === "waiting_callback") {
    return props.api.ui.DialogAlert({
      title: "Connect to Supabase",
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
      title: "You're all set",
      message: "Your Supabase account is connected and ready to go.\n\nClose this dialog to continue, or disconnect to sign out.",
      onConfirm: async () => {
        if (!lifecycle.chatSessionID) {
          lifecycle.chatSessionID = await ensureChatSession(props.api);
        }
        await injectOnboardingPrompt(props.api, props.logger, lifecycle);
        closeDialog();
      },
      onCancel: disconnect,
      label: "Disconnect",
    } as import("./opencode-runtime-extensions.ts").DialogConfirmWithLabel);
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
    message: "Your account is ready. Return to the current chat to pick a Supabase task when you're ready.",
    onConfirm: () => {
      closeDialog();
    },
    onCancel: closeDialog,
  });
}
