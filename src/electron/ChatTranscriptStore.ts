import fs from "node:fs/promises";
import path from "node:path";
import type { ChatAttachmentTranscriptStatus, ChatMessageAttachment, ChatMessageEvent } from "./chatEvents";

export interface ChatTranscriptStore {
  append(event: ChatMessageEvent): Promise<void>;
  readRecent(limit: number): Promise<ChatMessageEvent[]>;
}

export class JsonlChatTranscriptStore implements ChatTranscriptStore {
  constructor(private readonly filePath: string) {}

  async append(event: ChatMessageEvent): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async readRecent(limit: number): Promise<ChatMessageEvent[]> {
    if (limit <= 0) {
      return [];
    }

    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const events = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseChatEvent)
      .filter((event): event is ChatMessageEvent => Boolean(event));

    return events.slice(-limit);
  }
}

function parseChatEvent(line: string): ChatMessageEvent | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    return isChatMessageEvent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isChatMessageEvent(value: unknown): value is ChatMessageEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Record<string, unknown>;
  return (
    typeof event.eventId === "string" &&
    typeof event.requestId === "string" &&
    typeof event.role === "string" &&
    (event.kind === "user" || event.kind === "assistant" || event.kind === "system" || event.kind === "error") &&
    typeof event.text === "string" &&
    typeof event.timestamp === "string" &&
    (event.meta === undefined || Array.isArray(event.meta)) &&
    (event.attachments === undefined || (Array.isArray(event.attachments) && event.attachments.every(isChatMessageAttachment)))
  );
}

function isChatMessageAttachment(value: unknown): value is ChatMessageAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    isAttachmentKind(attachment.kind) &&
    (attachment.fileName === undefined || typeof attachment.fileName === "string") &&
    (attachment.mimeType === undefined || typeof attachment.mimeType === "string") &&
    (attachment.mediaUrl === undefined || typeof attachment.mediaUrl === "string") &&
    (attachment.width === undefined || typeof attachment.width === "number") &&
    (attachment.height === undefined || typeof attachment.height === "number") &&
    (attachment.sizeBytes === undefined || typeof attachment.sizeBytes === "number") &&
    (attachment.durationSeconds === undefined || typeof attachment.durationSeconds === "number") &&
    (attachment.transcript === undefined || isChatAttachmentTranscript(attachment.transcript))
  );
}

function isChatAttachmentTranscript(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const transcript = value as Record<string, unknown>;
  return (
    isTranscriptStatus(transcript.status) &&
    (transcript.text === undefined || typeof transcript.text === "string") &&
    (transcript.error === undefined || typeof transcript.error === "string") &&
    (transcript.provider === undefined || typeof transcript.provider === "string")
  );
}

function isAttachmentKind(value: unknown): value is ChatMessageAttachment["kind"] {
  return (
    value === "photo" ||
    value === "document" ||
    value === "audio" ||
    value === "voice" ||
    value === "video" ||
    value === "animation" ||
    value === "sticker" ||
    value === "video_note" ||
    value === "unknown"
  );
}

function isTranscriptStatus(value: unknown): value is ChatAttachmentTranscriptStatus {
  return value === "ok" || value === "unavailable" || value === "failed";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
