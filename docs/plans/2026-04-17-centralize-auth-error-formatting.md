# Centralize Auth Error Formatting — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ad-hoc `error.message || fallback` patterns with a single `formatAuthError(stage, error)` helper, fixing inconsistencies between toast/dialog and browser/TUI error messages.

**Architecture:** Create `src/shared/auth-errors.ts` with a small helper that extracts a human-readable message from any error-like value, falling back to a stage-specific default. Use it in `dialog.tsx` (4 sites) and `auth.ts` (1 site). The broker exchange fix ensures browser and TUI show the same message.

**Tech Stack:** TypeScript, bun:test, biome

---

### Task 1: Create the helper module

**Files:**
- Create: `src/shared/auth-errors.ts`
- Create: `test/auth-errors.test.ts`

**Step 1: Write the failing tests**

```typescript
// test/auth-errors.test.ts
import { describe, expect, test } from "bun:test";
import { formatAuthError } from "../src/shared/auth-errors.ts";
import { BrokerClientError } from "../src/shared/broker.ts";

describe("formatAuthError", () => {
  describe("error message extraction", () => {
    test("extracts message from Error instance", () => {
      expect(formatAuthError("unknown", new Error("something broke"))).toBe("something broke");
    });

    test("extracts message from BrokerClientError", () => {
      const err = new BrokerClientError({ code: "unauthorized", message: "bad token", status: 401 });
      expect(formatAuthError("exchange", err)).toBe("bad token");
    });

    test("extracts message from object with .message property", () => {
      expect(formatAuthError("start", { message: "API error detail" })).toBe("API error detail");
    });

    test("returns string directly when error is a string", () => {
      expect(formatAuthError("unknown", "plain string error")).toBe("plain string error");
    });

    test("ignores non-string .message property", () => {
      expect(formatAuthError("unknown", { message: 42 })).toBe("Authorization failed");
    });
  });

  describe("fallback behavior", () => {
    test("uses start fallback for null", () => {
      expect(formatAuthError("start", null)).toBe("Failed to start OAuth authorization");
    });

    test("uses start fallback for undefined", () => {
      expect(formatAuthError("start", undefined)).toBe("Failed to start OAuth authorization");
    });

    test("uses start fallback for empty Error", () => {
      expect(formatAuthError("start", new Error(""))).toBe("Failed to start OAuth authorization");
    });

    test("uses callback fallback", () => {
      expect(formatAuthError("callback", undefined)).toBe("OAuth callback failed");
    });

    test("uses exchange fallback", () => {
      expect(formatAuthError("exchange", undefined)).toBe("Authorization failed");
    });

    test("uses unknown fallback", () => {
      expect(formatAuthError("unknown", undefined)).toBe("Authorization failed");
    });

    test("uses unknown fallback for number", () => {
      expect(formatAuthError("unknown", 42)).toBe("Authorization failed");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test test/auth-errors.test.ts`
Expected: FAIL — `formatAuthError` is not exported

**Step 3: Write the implementation**

```typescript
// src/shared/auth-errors.ts
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
```

**Step 4: Run tests to verify they pass**

Run: `bun test test/auth-errors.test.ts`
Expected: all tests PASS

**Step 5: Run lint + typecheck**

Run: `biome check . && bunx tsc --noEmit`
Expected: clean

**Step 6: Commit**

```bash
git add src/shared/auth-errors.ts test/auth-errors.test.ts
git commit -m "feat: add formatAuthError helper with stage-based fallbacks"
```

---

### Task 2: Refactor dialog.tsx to use formatAuthError

**Files:**
- Modify: `src/tui/dialog.tsx`
- Modify: `test/auth-errors.test.ts` (add integration-level coverage note)

This task replaces the 4 inline formatting sites in `dialog.tsx` and fixes the toast/dialog inconsistency.

**Step 1: Add import**

At `src/tui/dialog.tsx:4`, add after the existing import:

```typescript
import type { SupabaseLogger } from "../shared/log.ts";
```

becomes:

```typescript
import { formatAuthError } from "../shared/auth-errors.ts";
import type { SupabaseLogger } from "../shared/log.ts";
```

**Step 2: Replace start-auth API error formatting (L46-49)**

Current:
```typescript
      if (authResponse.error) {
        throw new Error(
          authResponse.error.message || "Failed to start OAuth authorization",
        );
      }
```

Replace with:
```typescript
      if (authResponse.error) {
        throw new Error(formatAuthError("start", authResponse.error));
      }
```

**Step 3: Replace callback API error formatting (L88-91)**

Current:
```typescript
      if (callbackResponse.error) {
        throw new Error(
          callbackResponse.error.message || "OAuth callback failed",
        );
      }
```

Replace with:
```typescript
      if (callbackResponse.error) {
        throw new Error(formatAuthError("callback", callbackResponse.error));
      }
```

**Step 4: Replace catch-block formatting (L110-122)**

This is the main inconsistency fix. Current:
```typescript
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Authorization failed";
      await props.logger.error("supabase auth failed", {
        message,
      });
      setState({ type: "error", message });
      props.api.ui.toast({
        variant: "error",
        message: `Supabase authorization failed: ${message}`,
      });
      props.onClose();
    }
```

Replace with:
```typescript
    } catch (error) {
      const message = formatAuthError("unknown", error);
      await props.logger.error("supabase auth failed", {
        message,
      });
      setState({ type: "error", message });
      props.api.ui.toast({
        variant: "error",
        message,
      });
      props.onClose();
    }
```

Key changes:
- `formatAuthError("unknown", error)` replaces the `instanceof Error` check
- Toast uses same `message` as dialog state — no more `"Supabase authorization failed: "` prefix

**Step 5: Run full tests**

Run: `bun test`
Expected: all tests PASS (no existing tests assert on dialog error messages)

**Step 6: Run lint + typecheck**

Run: `biome check . && bunx tsc --noEmit`
Expected: clean

**Step 7: Commit**

```bash
git add src/tui/dialog.tsx
git commit -m "refactor: use formatAuthError in dialog, fix toast/dialog message inconsistency"
```

---

### Task 3: Fix auth.ts broker exchange inconsistency

**Files:**
- Modify: `src/server/auth.ts`

This fixes the bug where browser and TUI receive different error messages for the same broker exchange failure.

**Step 1: Add import**

At `src/server/auth.ts:4-8`, the existing import block:

```typescript
import {
  BrokerClientError,
  type BrokerConfig,
  exchangeCodeThroughBroker,
} from "../shared/broker.ts";
```

Add after it:

```typescript
import { formatAuthError } from "../shared/auth-errors.ts";
```

**Step 2: Replace broker exchange catch block (L183-199)**

Current:
```typescript
            } catch (cause) {
              const errorMessage = cause instanceof BrokerClientError
                ? `Authorization failed: ${cause.message}`
                : "Authorization failed";

              await deps.logger?.error("supabase auth failed", {
                status: cause instanceof BrokerClientError ? cause.status : 400,
                broker_error: cause instanceof BrokerClientError,
              });

              pending.reject(cause instanceof Error ? cause : new Error(String(cause)));
              await stopServerIfIdle(deps.logger, "broker_exchange_failed");

              return new Response(htmlError(errorMessage), {
                status: cause instanceof BrokerClientError && cause.status >= 500 ? 502 : 400,
                headers: { "Content-Type": "text/html" },
              });
            }
```

Replace with:
```typescript
            } catch (cause) {
              const message = formatAuthError("exchange", cause);

              await deps.logger?.error("supabase auth failed", {
                status: cause instanceof BrokerClientError ? cause.status : 400,
                broker_error: cause instanceof BrokerClientError,
              });

              pending.reject(new Error(message));
              await stopServerIfIdle(deps.logger, "broker_exchange_failed");

              return new Response(htmlError(message), {
                status: cause instanceof BrokerClientError && cause.status >= 500 ? 502 : 400,
                headers: { "Content-Type": "text/html" },
              });
            }
```

Key changes:
- Both `pending.reject()` and `htmlError()` now use the same `message` — fixing the browser/TUI inconsistency
- `formatAuthError("exchange", cause)` extracts message from `BrokerClientError`, `Error`, or falls back to `"Authorization failed"`
- `pending.reject(new Error(message))` replaces `cause instanceof Error ? cause : new Error(String(cause))`

**Step 3: Verify existing test still passes**

The existing test at `test/server-auth.test.ts:141` asserts:
```typescript
await expect(pending).rejects.toThrow("redirect_uri not allowed");
```

`formatAuthError("exchange", brokerClientError)` returns `"redirect_uri not allowed"` (the BrokerClientError message), so this assertion still passes.

Run: `bun test test/server-auth.test.ts`
Expected: all tests PASS

**Step 4: Run lint + typecheck**

Run: `biome check . && bunx tsc --noEmit`
Expected: clean

**Step 5: Commit**

```bash
git add src/server/auth.ts
git commit -m "fix: use consistent error message for broker exchange in both TUI and browser"
```

---

### Task 4: Final verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: all tests PASS

**Step 2: Run lint + typecheck**

Run: `biome check . && bunx tsc --noEmit`
Expected: clean

---

## Summary of changes

| File | Change |
|------|--------|
| `src/shared/auth-errors.ts` | NEW — `formatAuthError(stage, error)` helper |
| `test/auth-errors.test.ts` | NEW — unit tests for all extraction + fallback paths |
| `src/tui/dialog.tsx` | Use `formatAuthError` at 3 sites, remove toast prefix |
| `src/server/auth.ts` | Use `formatAuthError` for broker exchange, fix browser/TUI inconsistency |

## What this does NOT change

These sites keep their existing hardcoded messages (they're fixed strings, not `|| fallback` patterns):
- `dialog.tsx:54-55` — `"Invalid OAuth authorization response"` (missing URL)
- `dialog.tsx:107-108` — `"OAuth authorization was denied"` (user denied)
- `auth.ts:106` — `"Missing required state parameter..."` (browser HTML)
- `auth.ts:114` — `"Invalid or expired state parameter..."` (browser HTML)
- `auth.ts:128` — `errorDescription \|\| error` (provider error, plain strings)
- `auth.ts:136-148` — `"Missing authorization code"` (both paths)
- `auth.ts:218-220` — ports busy message (dynamic, server startup)
- `auth.ts:258` — timeout message
- `auth.ts:324` — server stopped message
