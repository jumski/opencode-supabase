import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { clearSavedAuth, getStoreFile, readSavedAuth, writeSavedAuth } from "../src/server/store.ts";

type PluginLikeInput = {
  directory: string;
  worktree: string;
};

const cleanupPaths: string[] = [];

async function createInput(): Promise<PluginLikeInput> {
  const root = await mkdtemp(join(tmpdir(), "opencode-supabase-store-"));
  cleanupPaths.push(root);
  return {
    directory: join(root, "packages", "consumer"),
    worktree: root,
  };
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("server auth store", () => {
  test("stores auth in a plugin-owned file under the worktree .opencode directory", async () => {
    const input = await createInput();

    expect(getStoreFile(input)).toBe(join(input.worktree, ".opencode", "supabase-auth.json"));
  });

  test("reads empty state before any auth is written", async () => {
    const input = await createInput();

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
  });

  test("writes and reads back saved auth tokens", async () => {
    const input = await createInput();

    await writeSavedAuth(input, {
      access: "access-token",
      refresh: "refresh-token",
      expires: 12345,
    });

    await expect(readSavedAuth(input)).resolves.toEqual({
      version: 1,
      auth: {
        access: "access-token",
        refresh: "refresh-token",
        expires: 12345,
      },
    });
  });

  test("clears persisted auth without deleting the store version", async () => {
    const input = await createInput();

    await writeSavedAuth(input, {
      access: "access-token",
      refresh: "refresh-token",
      expires: 12345,
    });
    await clearSavedAuth(input);

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
  });

  test("falls back to the session directory when worktree is unavailable", async () => {
    const input = await createInput();

    expect(getStoreFile({ ...input, worktree: "" })).toBe(
      join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("falls back to the session directory when worktree resolves to root", async () => {
    const input = await createInput();

    expect(getStoreFile({ ...input, worktree: "/" })).toBe(
      join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("falls back to the session directory when worktree is unrelated", async () => {
    const input = await createInput();

    expect(getStoreFile({ ...input, worktree: resolve(input.worktree, "..", "unrelated") })).toBe(
      join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("falls back to the session directory when worktree is nested inside the directory", async () => {
    const input = await createInput();

    expect(getStoreFile({ ...input, worktree: join(input.directory, "nested") })).toBe(
      join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });
});
