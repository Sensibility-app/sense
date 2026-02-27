import { join, normalize } from "@std/path";

const BASE_DIR = Deno.cwd();

export function getBaseDir(): string {
  return BASE_DIR;
}

export function resolvePath(path: string): string {
  const cleanPath = path.replace(/^\.?\//, "");
  return normalize(join(BASE_DIR, cleanPath));
}

export const sanitizePath = resolvePath;

export function resolveSearchPath(path?: string): string {
  return (!path || path === "/") ? BASE_DIR : resolvePath(path);
}

export function sanitizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
