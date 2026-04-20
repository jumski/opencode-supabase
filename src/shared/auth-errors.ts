export type AuthErrorStage = "start" | "callback" | "exchange" | "unknown";

const FALLBACKS: Record<AuthErrorStage, string> = {
  start: "Failed to start OAuth authorization",
  callback: "OAuth callback failed",
  exchange: "Authorization failed",
  unknown: "Authorization failed",
};

function getObjectMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  if ("message" in value) {
    const message = (value as { message: unknown }).message;
    if (typeof message === "string") return message || undefined;
  }

  return undefined;
}

function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || undefined;
  if (typeof error === "string") return error || undefined;
  const message = getObjectMessage(error);
  if (message) return message;

  if (error && typeof error === "object") {
    const dataMessage = getObjectMessage((error as { data?: unknown }).data);
    if (dataMessage) return dataMessage;

    const nestedData = (error as { data?: { data?: unknown } }).data?.data;
    const nestedDataMessage = getObjectMessage(nestedData);
    if (nestedDataMessage) return nestedDataMessage;

    const firstError = Array.isArray((error as { errors?: unknown }).errors)
      ? (error as { errors: unknown[] }).errors[0]
      : undefined;
    const firstErrorMessage = getObjectMessage(firstError);
    if (firstErrorMessage) return firstErrorMessage;
  }

  return undefined;
}

export function formatAuthError(stage: AuthErrorStage, error: unknown): string {
  return extractErrorMessage(error) || FALLBACKS[stage];
}
