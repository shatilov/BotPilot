import path from "node:path";
import type { IncomingAttachment, IncomingMessage } from "../domain/types";
import type { TelegramBotClient } from "./TelegramBotClient";
import type { TelegramCallbackQuery, TelegramChat, TelegramFileRef, TelegramMessage, TelegramUpdate } from "./types";

export interface TelegramNormalizedMessage {
  incoming: IncomingMessage;
  replyChatId: string | number;
  replyToMessageId?: number;
  messageThreadId?: number;
}

export interface TelegramNormalizerOptions {
  client: TelegramBotClient;
  trustedChatId: string;
  filesRoot: string;
}

export type TelegramNormalizeResult =
  | { kind: "message"; message: TelegramNormalizedMessage }
  | { kind: "ignored"; reason: string };

const MESSAGE_UPDATE_FIELDS = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "business_message",
  "edited_business_message",
] as const;

const MESSAGE_CONTENT_FIELDS = [
  "text",
  "animation",
  "audio",
  "document",
  "paid_media",
  "photo",
  "sticker",
  "story",
  "video",
  "video_note",
  "voice",
  "caption",
  "checklist",
  "contact",
  "dice",
  "game",
  "poll",
  "venue",
  "location",
  "new_chat_members",
  "left_chat_member",
  "chat_owner_left",
  "chat_owner_changed",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "message_auto_delete_timer_changed",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "pinned_message",
  "invoice",
  "successful_payment",
  "refunded_payment",
  "users_shared",
  "chat_shared",
  "gift",
  "unique_gift",
  "gift_upgrade_sent",
  "connected_website",
  "write_access_allowed",
  "passport_data",
  "proximity_alert_triggered",
  "boost_added",
  "chat_background_set",
  "checklist_tasks_done",
  "checklist_tasks_added",
  "direct_message_price_changed",
  "forum_topic_created",
  "forum_topic_edited",
  "forum_topic_closed",
  "forum_topic_reopened",
  "general_forum_topic_hidden",
  "general_forum_topic_unhidden",
  "giveaway_created",
  "giveaway",
  "giveaway_winners",
  "giveaway_completed",
  "managed_bot_created",
  "paid_message_price_changed",
  "poll_option_added",
  "poll_option_deleted",
  "suggested_post_approved",
  "suggested_post_approval_failed",
  "suggested_post_declined",
  "suggested_post_paid",
  "suggested_post_refunded",
  "video_chat_scheduled",
  "video_chat_started",
  "video_chat_ended",
  "video_chat_participants_invited",
  "web_app_data",
] as const;

export async function normalizeTelegramUpdate(
  update: TelegramUpdate,
  options: TelegramNormalizerOptions,
): Promise<TelegramNormalizeResult> {
  const messageEntry = getMessageFromUpdate(update);
  if (messageEntry) {
    return normalizeMessageUpdate(update.update_id, messageEntry.updateKind, messageEntry.message, options);
  }

  if (update.callback_query) {
    return normalizeCallbackQuery(update.update_id, update.callback_query, options);
  }

  return { kind: "ignored", reason: "update type is not a chat message" };
}

function getMessageFromUpdate(update: TelegramUpdate): { updateKind: string; message: TelegramMessage } | undefined {
  for (const field of MESSAGE_UPDATE_FIELDS) {
    const value = update[field];
    if (isTelegramMessage(value)) {
      return { updateKind: field, message: value };
    }
  }

  return undefined;
}

async function normalizeMessageUpdate(
  updateId: number,
  updateKind: string,
  message: TelegramMessage,
  options: TelegramNormalizerOptions,
): Promise<TelegramNormalizeResult> {
  if (!isTrustedChat(message.chat, options.trustedChatId)) {
    return { kind: "ignored", reason: `untrusted chat ${String(message.chat.id)}` };
  }

  const contentTypes = detectMessageContentTypes(message);
  const attachments = await buildAttachments(message, updateId, options);
  const text = buildIncomingText(message, contentTypes, attachments);

  return {
    kind: "message",
    message: {
      incoming: {
        id: `telegram:${updateId}:${message.message_id}`,
        transport: "telegram",
        chatId: String(message.chat.id),
        senderId: message.from ? String(message.from.id) : undefined,
        senderName: formatSenderName(message),
        text,
        receivedAt: message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString(),
        attachments,
        metadata: {
          telegram: {
            updateId,
            updateKind,
            messageId: message.message_id,
            messageThreadId: message.message_thread_id,
            contentTypes,
            chat: summarizeChat(message.chat),
            from: message.from ? summarizeUser(message.from) : undefined,
          },
        },
      },
      replyChatId: message.chat.id,
      replyToMessageId: message.message_id,
      messageThreadId: message.message_thread_id,
    },
  };
}

function normalizeCallbackQuery(
  updateId: number,
  query: TelegramCallbackQuery,
  options: TelegramNormalizerOptions,
): TelegramNormalizeResult {
  const chat = query.message?.chat;
  if (!chat || !isTrustedChat(chat, options.trustedChatId)) {
    return { kind: "ignored", reason: "callback query is not from trusted chat" };
  }

  const data = query.data ?? query.game_short_name ?? "";
  return {
    kind: "message",
    message: {
      incoming: {
        id: `telegram:${updateId}:callback:${query.id}`,
        transport: "telegram",
        chatId: String(chat.id),
        senderId: String(query.from.id),
        senderName: formatUserName(query.from),
        text: data ? `Telegram callback query: ${data}` : "Telegram callback query without payload.",
        receivedAt: new Date().toISOString(),
        metadata: {
          telegram: {
            updateId,
            updateKind: "callback_query",
            callbackQueryId: query.id,
            chat: summarizeChat(chat),
            from: summarizeUser(query.from),
          },
        },
      },
      replyChatId: chat.id,
      replyToMessageId: query.message?.message_id,
      messageThreadId: query.message?.message_thread_id,
    },
  };
}

async function buildAttachments(
  message: TelegramMessage,
  updateId: number,
  options: TelegramNormalizerOptions,
): Promise<IncomingAttachment[]> {
  const media = collectPrimaryMedia(message);
  const attachments: IncomingAttachment[] = [];

  for (const item of media) {
    attachments.push(await buildAttachment(item, message, updateId, options));
  }

  return attachments;
}

async function buildAttachment(
  item: { kind: IncomingAttachment["kind"]; file: TelegramFileRef },
  message: TelegramMessage,
  updateId: number,
  options: TelegramNormalizerOptions,
): Promise<IncomingAttachment> {
  const id = item.file.file_unique_id ?? item.file.file_id;
  const attachment: IncomingAttachment = {
    id,
    kind: item.kind,
    fileName: item.file.file_name,
    mimeType: item.file.mime_type,
    remoteId: item.file.file_id,
    metadata: {
      telegramFileUniqueId: item.file.file_unique_id,
      telegramFileSize: item.file.file_size,
      width: item.file.width,
      height: item.file.height,
      duration: item.file.duration,
    },
  };

  try {
    const fileInfo = await options.client.getFile(item.file.file_id);
    if (!fileInfo.file_path) {
      attachment.metadata = {
        ...attachment.metadata,
        downloadSkipped: "Telegram did not return file_path",
      };
      return attachment;
    }

    const fileName = buildFileName(item, message, updateId, fileInfo.file_path);
    const localPath = path.join(options.filesRoot, String(message.chat.id), fileName);
    await options.client.downloadFile(fileInfo.file_path, localPath);
    attachment.localPath = localPath;
    attachment.fileName = attachment.fileName ?? path.basename(fileInfo.file_path);
    attachment.metadata = {
      ...attachment.metadata,
      telegramFilePath: fileInfo.file_path,
      downloaded: true,
    };
  } catch (error) {
    attachment.metadata = {
      ...attachment.metadata,
      downloadError: error instanceof Error ? error.message : String(error),
    };
  }

  return attachment;
}

function collectPrimaryMedia(message: TelegramMessage): Array<{ kind: IncomingAttachment["kind"]; file: TelegramFileRef }> {
  const items: Array<{ kind: IncomingAttachment["kind"]; file: TelegramFileRef }> = [];

  const photo = selectLargestPhoto(message.photo);
  if (photo) {
    items.push({ kind: "photo", file: photo });
  }

  const newChatPhoto = selectLargestPhoto(message.new_chat_photo);
  if (newChatPhoto) {
    items.push({ kind: "photo", file: newChatPhoto });
  }

  items.push(...collectPaidMedia(message.paid_media));

  if (message.animation) {
    items.push({ kind: "animation", file: message.animation });
  }
  if (message.audio) {
    items.push({ kind: "audio", file: message.audio });
  }
  if (message.document && !message.animation) {
    items.push({ kind: "document", file: message.document });
  }
  if (message.sticker) {
    items.push({ kind: "sticker", file: message.sticker });
  }
  if (message.video) {
    items.push({ kind: "video", file: message.video });
  }
  if (message.video_note) {
    items.push({ kind: "video_note", file: message.video_note });
  }
  if (message.voice) {
    items.push({ kind: "voice", file: message.voice });
  }

  return items;
}

function collectPaidMedia(value: unknown): Array<{ kind: IncomingAttachment["kind"]; file: TelegramFileRef }> {
  const paidMedia = isObject(value) && Array.isArray(value.paid_media) ? value.paid_media : [];
  const items: Array<{ kind: IncomingAttachment["kind"]; file: TelegramFileRef }> = [];

  for (const media of paidMedia) {
    if (!isObject(media)) {
      continue;
    }

    const photo = selectLargestPhoto(Array.isArray(media.photo) ? media.photo.filter(isTelegramFileRef) : undefined);
    if (photo) {
      items.push({ kind: "photo", file: photo });
    }

    if (isTelegramFileRef(media.video)) {
      items.push({ kind: "video", file: media.video });
    }
  }

  return items;
}

function selectLargestPhoto(photo: TelegramFileRef[] | undefined): TelegramFileRef | undefined {
  return photo?.slice().sort((left, right) => scorePhoto(right) - scorePhoto(left))[0];
}

function scorePhoto(photo: TelegramFileRef): number {
  return photo.file_size ?? (photo.width ?? 0) * (photo.height ?? 0);
}

function buildIncomingText(
  message: TelegramMessage,
  contentTypes: string[],
  attachments: IncomingAttachment[],
): string {
  if (message.text?.trim()) {
    return message.text.trim();
  }

  const lines = [`Telegram message: ${contentTypes.length ? contentTypes.join(", ") : "unknown content"}.`];
  if (message.caption?.trim()) {
    lines.push(`Caption: ${message.caption.trim()}`);
  }
  if (attachments.length > 0) {
    lines.push("Attachments:");
    for (const attachment of attachments) {
      lines.push(`- ${attachment.kind}: ${attachment.localPath ?? attachment.fileName ?? attachment.remoteId ?? attachment.id}`);
    }
  }
  lines.push("Respond naturally to the user and use the attachment metadata or local files when needed.");
  return lines.join("\n");
}

function detectMessageContentTypes(message: TelegramMessage): string[] {
  return MESSAGE_CONTENT_FIELDS.filter((field) => message[field] !== undefined);
}

function buildFileName(
  item: { kind: IncomingAttachment["kind"]; file: TelegramFileRef },
  message: TelegramMessage,
  updateId: number,
  filePath: string,
): string {
  const extension = path.extname(filePath);
  const sourceName = item.file.file_name ? sanitizeFileName(item.file.file_name) : "";
  if (sourceName) {
    return `${updateId}-${message.message_id}-${sourceName}`;
  }

  const suffix = sanitizeFileName(item.file.file_unique_id ?? item.file.file_id).slice(0, 32);
  return `${updateId}-${message.message_id}-${item.kind}-${suffix}${extension}`;
}

function isTrustedChat(chat: TelegramChat, trustedChatId: string): boolean {
  const trusted = trustedChatId.trim();
  if (!trusted) {
    return false;
  }

  if (trusted.startsWith("@")) {
    return chat.username ? `@${chat.username}`.toLowerCase() === trusted.toLowerCase() : false;
  }

  return String(chat.id) === trusted;
}

function formatSenderName(message: TelegramMessage): string | undefined {
  if (message.from) {
    return formatUserName(message.from);
  }

  if (message.sender_chat) {
    return message.sender_chat.title ?? message.sender_chat.username ?? String(message.sender_chat.id);
  }

  return undefined;
}

function formatUserName(user: { first_name?: string; last_name?: string; username?: string; id: number }): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || (user.username ? `@${user.username}` : String(user.id));
}

function summarizeChat(chat: TelegramChat): Record<string, unknown> {
  return {
    id: String(chat.id),
    type: chat.type,
    title: chat.title,
    username: chat.username,
  };
}

function summarizeUser(user: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }): Record<string, unknown> {
  return {
    id: String(user.id),
    isBot: user.is_bot,
    name: formatUserName(user),
    username: user.username,
  };
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function isTelegramMessage(value: unknown): value is TelegramMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as TelegramMessage).message_id === "number" &&
      (value as TelegramMessage).chat &&
      typeof (value as TelegramMessage).chat === "object",
  );
}

function isTelegramFileRef(value: unknown): value is TelegramFileRef {
  return Boolean(value && typeof value === "object" && typeof (value as TelegramFileRef).file_id === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
