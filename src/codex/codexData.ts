import { opendir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface CodexChatSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface CodexChatMessage {
  role: string;
  text: string;
}

export interface CodexChatDetails extends CodexChatSummary {
  transcriptPath?: string;
  messages: CodexChatMessage[];
}

export interface CodexProject {
  path: string;
  trustLevel?: string;
}

const DEFAULT_CODEX_HOME = path.join(os.homedir(), ".codex");

export async function listCodexChats(options: { limit?: number; codexHome?: string } = {}): Promise<CodexChatSummary[]> {
  const codexHome = options.codexHome ?? DEFAULT_CODEX_HOME;
  const raw = await readFile(path.join(codexHome, "session_index.jsonl"), "utf8");
  const limit = options.limit ?? 50;

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((item) => typeof item.id === "string")
    .map((item) => ({
      id: String(item.id),
      name: typeof item.thread_name === "string" ? item.thread_name : "(untitled)",
      updatedAt: typeof item.updated_at === "string" ? item.updated_at : "",
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
}

export async function getCodexChat(options: {
  id: string;
  maxMessages?: number;
  codexHome?: string;
}): Promise<CodexChatDetails> {
  const codexHome = options.codexHome ?? DEFAULT_CODEX_HOME;
  const chats = await listCodexChats({ limit: 10000, codexHome });
  const summary = chats.find((chat) => chat.id === options.id);
  if (!summary) {
    throw new Error(`Codex chat not found: ${options.id}`);
  }

  const transcriptPath = await findTranscriptPath(codexHome, options.id);
  if (!transcriptPath) {
    return { ...summary, messages: [] };
  }

  const raw = await readFile(transcriptPath, "utf8");
  const messages = parseTranscriptMessages(raw).slice(-(options.maxMessages ?? 40));
  return {
    ...summary,
    transcriptPath,
    messages,
  };
}

export async function listCodexProjects(options: { codexHome?: string } = {}): Promise<CodexProject[]> {
  const codexHome = options.codexHome ?? DEFAULT_CODEX_HOME;
  const raw = await readFile(path.join(codexHome, "config.toml"), "utf8");
  const projects: CodexProject[] = [];
  let current: CodexProject | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const header = line.match(/^\[projects\."(.+)"\]$/);
    if (header) {
      current = { path: unescapeTomlString(header[1]) };
      projects.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const trust = line.match(/^trust_level\s*=\s*"(.+)"$/);
    if (trust) {
      current.trustLevel = trust[1];
    }
  }

  return projects;
}

async function findTranscriptPath(codexHome: string, id: string): Promise<string | undefined> {
  for (const root of [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")]) {
    const found = await findFileContaining(root, id);
    if (found) {
      return found;
    }
  }

  return undefined;
}

async function findFileContaining(root: string, needle: string): Promise<string | undefined> {
  let directory;
  try {
    directory = await opendir(root);
  } catch {
    return undefined;
  }

  for await (const entry of directory) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findFileContaining(entryPath, needle);
      if (found) {
        return found;
      }
      continue;
    }

    if (entry.isFile() && entry.name.includes(needle) && entry.name.endsWith(".jsonl")) {
      return entryPath;
    }
  }

  return undefined;
}

function parseTranscriptMessages(raw: string): CodexChatMessage[] {
  const messages: CodexChatMessage[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let item: unknown;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }

    const message = parseResponseMessage(item);
    if (message && message.text.trim()) {
      messages.push(message);
    }
  }

  return messages;
}

function parseResponseMessage(item: unknown): CodexChatMessage | undefined {
  if (!isRecord(item) || item.type !== "response_item" || !isRecord(item.payload)) {
    return undefined;
  }

  const payload = item.payload;
  if (payload.type !== "message" || typeof payload.role !== "string" || !Array.isArray(payload.content)) {
    return undefined;
  }

  const text = payload.content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }

      if (typeof part.text === "string") {
        return part.text;
      }

      if (typeof part.input_text === "string") {
        return part.input_text;
      }

      if (typeof part.output_text === "string") {
        return part.output_text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");

  return {
    role: payload.role,
    text,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function unescapeTomlString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
