export type AuthErrorStage = "start" | "callback" | "exchange" | "unknown";

const FALLBACKS: Record<AuthErrorStage, string> = {
  start: "Failed to start OAuth authorization",
  callback: "OAuth callback failed",
  exchange: "Authorization failed",
  unknown: "Authorization failed",
};

function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || undefined;
  if (typeof error === "string") return error || undefined;
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message: unknown }).message;
    if (typeof msg === "string") return msg || undefined;
  }
  return undefined;
}

export function formatAuthError(stage: AuthErrorStage, error: unknown): string {
  return extractErrorMessage(error) || FALLBACKS[stage];
}
