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

    test("extracts message from NamedError-like .data.message", () => {
      expect(formatAuthError("callback", { name: "UnknownError", data: { message: "broker rejected code" } })).toBe(
        "broker rejected code",
      );
    });

    test("extracts message from SDK-style .data.data.message", () => {
      expect(
        formatAuthError("callback", {
          data: {
            name: "UnknownError",
            data: {
              message: "redirect_uri not allowed",
            },
          },
          errors: [],
          success: false,
        }),
      ).toBe("redirect_uri not allowed");
    });

    test("extracts message from first .errors entry", () => {
      expect(
        formatAuthError("start", {
          data: null,
          errors: [{ message: "provider auth callback failed" }],
          success: false,
        }),
      ).toBe("provider auth callback failed");
    });

    test("returns string directly when error is a string", () => {
      expect(formatAuthError("unknown", "plain string error")).toBe("plain string error");
    });

    test("ignores non-string .message property", () => {
      expect(formatAuthError("unknown", { message: 42 })).toBe("Authorization failed");
    });

    test("ignores non-string nested messages", () => {
      expect(
        formatAuthError("callback", {
          data: {
            data: {
              message: 42,
            },
          },
          errors: [{ message: false }],
          success: false,
        }),
      ).toBe("OAuth callback failed");
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
