import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";

type SupabaseDialogProps = {
  api: TuiPluginApi;
  onClose: () => void;
};

type OAuthState =
  | { type: "idle" }
  | { type: "authorizing"; url: string }
  | { type: "waiting_callback"; url: string }
  | { type: "success" }
  | { type: "error"; message: string };

// API response types
type ApiError = { message?: string; [key: string]: unknown };
type ApiResponse<T> = { data?: T; error?: ApiError };

type AuthData = {
  url: string;
  instructions: string;
  method: string;
};

export function SupabaseDialog(props: SupabaseDialogProps) {
  const [state, setState] = createSignal<OAuthState>({ type: "idle" });

  const startOAuth = async () => {
    try {
      setState({ type: "authorizing", url: "" });

      // Start OAuth authorization
      const authResponse = (await props.api.client.provider.oauth.authorize({
        providerID: "supabase",
        method: 0,
      })) as unknown as ApiResponse<AuthData>;

      // Handle the response shape from the plugin API
      if (authResponse.error) {
        throw new Error(
          authResponse.error.message || "Failed to start OAuth authorization",
        );
      }

      const authData = authResponse.data;

      if (!authData?.url) {
        throw new Error("Invalid OAuth authorization response");
      }

      const { url, method } = authData;
      setState({ type: "authorizing", url });

      // Attempt to open browser automatically
      if (method === "auto") {
        try {
          const open = await import("open");
          await open.default(url);
        } catch {
          // Browser auto-open failed, user can click the URL manually
        }
      }

      setState({ type: "waiting_callback", url });

      // Wait for callback
      const callbackResponse = (await props.api.client.provider.oauth.callback({
        providerID: "supabase",
        method: 0,
      })) as unknown as ApiResponse<boolean>;

      if (callbackResponse.error) {
        throw new Error(
          callbackResponse.error.message || "OAuth callback failed",
        );
      }

      const callbackSucceeded = callbackResponse.data === true;

      if (callbackSucceeded) {
        setState({ type: "success" });
        props.api.ui.toast({
          variant: "success",
          message:
            "Connected to Supabase! Tools are ready to use. Ask your agent about supabase.",
        });
        props.onClose();
      } else {
        throw new Error("OAuth authorization was denied");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Authorization failed";
      setState({ type: "error", message });
      props.api.ui.toast({
        variant: "error",
        message: `Supabase authorization failed: ${message}`,
      });
      props.onClose();
    }
  };

  const currentState = state();

  if (currentState.type === "idle") {
    return props.api.ui.DialogConfirm({
      title: "Connect Supabase",
      message:
        "This will open a browser window to authorize OpenCode to access your Supabase account. Continue?",
      onConfirm: startOAuth,
      onCancel: props.onClose,
    });
  }

  if (currentState.type === "authorizing") {
    return props.api.ui.DialogAlert({
      title: "Connect Supabase",
      message: currentState.url
        ? `Opening browser to authorize Supabase...\n\nIf the browser doesn't open automatically, visit:\n${currentState.url}`
        : "Starting authorization...",
      onConfirm: props.onClose,
    });
  }

  if (currentState.type === "waiting_callback") {
    return props.api.ui.DialogAlert({
      title: "Connect Supabase",
      message: `Waiting for authorization in your browser...\n\nIf you need to complete authorization manually, visit:\n${currentState.url}`,
      onConfirm: props.onClose,
    });
  }

  if (currentState.type === "error") {
    return props.api.ui.DialogAlert({
      title: "Authorization Failed",
      message: currentState.message,
      onConfirm: props.onClose,
    });
  }

  // Success state (should close immediately via onClose)
  return props.api.ui.DialogAlert({
    title: "Connected",
    message: "Successfully connected to Supabase.",
    onConfirm: props.onClose,
  });
}
