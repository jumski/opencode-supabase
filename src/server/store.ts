import { mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

type StoreInput = Pick<PluginInput, "directory" | "worktree">;

export type SavedAuth = {
  access: string;
  refresh: string;
  expires: number;
};

export type SavedState = {
  version: 1;
  auth?: SavedAuth;
};

const STORE_FILE = "supabase-auth.json";

function resolveStoreRoot(input: StoreInput): string {
  const directory = resolve(input.directory);
  if (!input.worktree) {
    return directory;
  }

  const worktree = resolve(input.worktree);
  if (worktree === dirname(worktree)) {
    return directory;
  }

  const pathFromWorktree = relative(worktree, directory);
  if (
    pathFromWorktree === "" ||
    pathFromWorktree === "." ||
    (!pathFromWorktree.startsWith("..") && !pathFromWorktree.startsWith(`..${sep}`))
  ) {
    return worktree;
  }

  return directory;
}

export function file(input: StoreInput): string {
  const root = resolveStoreRoot(input);
  return join(root, ".opencode", STORE_FILE);
}

export async function read(input: StoreInput): Promise<SavedState> {
  const authFile = Bun.file(file(input));
  if (!(await authFile.exists())) {
    return { version: 1 };
  }

  const parsed = JSON.parse(await authFile.text()) as SavedState;
  if (parsed.version !== 1) {
    throw new Error("Unsupported Supabase auth store version");
  }
  return parsed.auth ? { version: 1, auth: parsed.auth } : { version: 1 };
}

export async function write(input: StoreInput, auth: SavedAuth): Promise<void> {
  const path = file(input);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify({ version: 1, auth }, null, 2));
}

export async function clear(input: StoreInput): Promise<void> {
  const path = file(input);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify({ version: 1 }, null, 2));
}

export const getStoreFile = file;
export const readSavedAuth = read;
export const writeSavedAuth = write;
export const clearSavedAuth = clear;
