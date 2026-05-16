import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const EXTRA_COMMAND_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  path.join(os.homedir(), ".local/bin"),
];

export function resolveCommand(command: string): string {
  if (path.isAbsolute(command)) {
    return command;
  }

  for (const directory of commandSearchPaths()) {
    const candidate = path.join(directory, command);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return command;
}

export function commandSearchPaths(pathValue = process.env.PATH): string[] {
  const fromEnv = (pathValue ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  return unique([
    ...fromEnv,
    ...EXTRA_COMMAND_PATHS,
  ]);
}

export function withCommandSearchPath(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      next[key] = value;
    }
  }

  next.PATH = commandSearchPaths(next.PATH ?? process.env.PATH).join(path.delimiter);
  return next;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
