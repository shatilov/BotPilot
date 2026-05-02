import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

function commandSearchPaths(): string[] {
  const fromEnv = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  return unique([
    ...fromEnv,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    path.join(os.homedir(), ".local/bin"),
  ]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
