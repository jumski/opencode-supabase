import { describe, expect, test } from "bun:test";

import tuiModule from "../src/tui/index.tsx";

describe("tui entrypoint", () => {
  test("exports the supabase tui plugin module", () => {
    expect(tuiModule.id).toBe("supabase");
    expect(typeof tuiModule.tui).toBe("function");
  });
});
