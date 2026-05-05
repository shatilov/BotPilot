import type { SendMessageOptions } from "./TelegramBotClient";
import type { TelegramChatId } from "./types";

export interface TelegramTextSender {
  sendMessage(options: SendMessageOptions): Promise<unknown>;
}

const TELEGRAM_MESSAGE_CHUNK_SIZE = 3900;
const HOST_MESSAGE_PREFIX = "Вы написали на хосте:";

export async function sendHostMessageMirror(
  client: TelegramTextSender,
  options: {
    chatId: TelegramChatId;
    text: string;
  },
): Promise<void> {
  await sendTelegramText(client, {
    chatId: options.chatId,
    text: formatHostMessageMirror(options.text),
  });
}

export async function sendTelegramText(
  client: TelegramTextSender,
  options: {
    chatId: TelegramChatId;
    text: string;
  },
): Promise<void> {
  const chunks = splitTelegramText(options.text);
  for (const text of chunks) {
    await client.sendMessage({
      chatId: options.chatId,
      text,
    });
  }
}

export function formatHostMessageMirror(text: string): string {
  const quotedText = quotePlainText(text.trim() || "(empty)");
  return `${HOST_MESSAGE_PREFIX}\n\n${quotedText}`;
}

function quotePlainText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function splitTelegramText(text: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += TELEGRAM_MESSAGE_CHUNK_SIZE) {
    chunks.push(text.slice(index, index + TELEGRAM_MESSAGE_CHUNK_SIZE));
  }
  return chunks.length ? chunks : [HOST_MESSAGE_PREFIX];
}
