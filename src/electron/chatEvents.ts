export type ChatMessageKind = "user" | "assistant" | "system" | "error";
export type ChatAttachmentKind = "photo" | "document" | "audio" | "voice" | "video" | "animation" | "sticker" | "video_note" | "unknown";
export type ChatAttachmentTranscriptStatus = "ok" | "unavailable" | "failed";

export interface ChatAttachmentTranscript {
  status: ChatAttachmentTranscriptStatus;
  text?: string;
  error?: string;
  provider?: string;
}

export interface ChatMessageAttachment {
  id: string;
  kind: ChatAttachmentKind;
  fileName?: string;
  mimeType?: string;
  mediaUrl?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  durationSeconds?: number;
  transcript?: ChatAttachmentTranscript;
}

export interface ChatMessageEvent {
  eventId: string;
  requestId: string;
  role: string;
  kind: ChatMessageKind;
  text: string;
  timestamp: string;
  meta?: string[];
  attachments?: ChatMessageAttachment[];
}
