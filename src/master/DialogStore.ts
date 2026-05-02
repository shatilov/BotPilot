import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DialogRecord {
  id: string;
  provider: string;
  externalThreadId: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface DialogStore {
  get(id: string): Promise<DialogRecord | undefined>;
  set(record: DialogRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

interface DialogStoreFile {
  version: 1;
  dialogs: Record<string, DialogRecord>;
}

export class JsonDialogStore implements DialogStore {
  constructor(private readonly filePath: string) {}

  async get(id: string): Promise<DialogRecord | undefined> {
    const file = await this.readFile();
    return file.dialogs[id];
  }

  async set(record: DialogRecord): Promise<void> {
    const file = await this.readFile();
    file.dialogs[record.id] = record;
    await this.writeFile(file);
  }

  async delete(id: string): Promise<void> {
    const file = await this.readFile();
    delete file.dialogs[id];
    await this.writeFile(file);
  }

  private async readFile(): Promise<DialogStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as DialogStoreFile;
      return {
        version: 1,
        dialogs: parsed.dialogs ?? {},
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { version: 1, dialogs: {} };
      }

      throw error;
    }
  }

  private async writeFile(file: DialogStoreFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}
