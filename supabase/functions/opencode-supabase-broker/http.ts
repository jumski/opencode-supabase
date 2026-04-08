import type { BrokerError, BrokerErrorBody } from "./types.ts";

export async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw createBrokerError(400, "invalid_request", "request body must be a JSON object");
    }

    return body as Record<string, unknown>;
  } catch (error) {
    if (isBrokerError(error)) {
      throw error;
    }

    throw createBrokerError(400, "invalid_request", "request body must be valid JSON");
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export function errorResponse(error: BrokerError): Response {
  const body: BrokerErrorBody = {
    error: {
      code: error.code,
      message: error.message,
    },
  };

  return jsonResponse(body, error.status);
}

export function createBrokerError(
  status: BrokerError["status"],
  code: BrokerError["code"],
  message: string,
): BrokerError {
  return { status, code, message };
}

export function isBrokerError(error: unknown): error is BrokerError {
  if (!error || typeof error !== "object") {
    return false;
  }

  return "status" in error && "code" in error && "message" in error;
}

export function requireMethod(request: Request, method: string): void {
  if (request.method !== method) {
    throw createBrokerError(400, "invalid_request", "unsupported path or method");
  }
}

export function requireNoExtraFields(body: Record<string, unknown>, allowedFields: string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowedFields.includes(key)) {
      throw createBrokerError(400, "invalid_request", `unknown field: ${key}`);
    }
  }
}

export function requireNonEmptyString(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw createBrokerError(400, "invalid_request", `${field} must be a non-empty string`);
  }

  return value;
}
