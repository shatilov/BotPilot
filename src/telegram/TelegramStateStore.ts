import fs from "node:fs/promises";
import path from "node:path";

export interface TelegramRuntimeState {
  offset?: number;
  lastAnsweredAt?: string;
}

export class JsonTelegramStateStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<TelegramRuntimeState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return isObject(parsed) ? (parsed as TelegramRuntimeState) : {};
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  async set(state: TelegramRuntimeState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
