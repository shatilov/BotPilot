import fs from "node:fs/promises";
import path from "node:path";
import type { TelegramApiResponse, TelegramChatId, TelegramFileInfo, TelegramUpdate } from "./types";

export interface GetUpdatesOptions {
  offset?: number;
  limit?: number;
  timeout?: number;
  allowedUpdates?: string[];
}

export interface SendMessageOptions {
  chatId: TelegramChatId;
  text: string;
  messageThreadId?: number;
  replyToMessageId?: number;
}

export class TelegramApiError extends Error {
  constructor(
    method: string,
    description: string,
    readonly errorCode?: number,
    readonly parameters?: Record<string, unknown>,
  ) {
    super(`Telegram API ${method} failed: ${description}`);
    this.name = "TelegramApiError";
  }
}

export class TelegramBotClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl = "https://api.telegram.org",
  ) {}

  getUpdates(options: GetUpdatesOptions = {}): Promise<TelegramUpdate[]> {
    return this.call("getUpdates", {
      offset: options.offset,
      limit: options.limit ?? 100,
      timeout: options.timeout ?? 0,
      allowed_updates: options.allowedUpdates,
    });
  }

  sendMessage(options: SendMessageOptions): Promise<unknown> {
    return this.call("sendMessage", {
      chat_id: options.chatId,
      text: options.text,
      message_thread_id: options.messageThreadId,
      reply_parameters: options.replyToMessageId
        ? {
            message_id: options.replyToMessageId,
            allow_sending_without_reply: true,
          }
        : undefined,
    });
  }

  sendChatAction(chatId: TelegramChatId, action = "typing", messageThreadId?: number): Promise<unknown> {
    return this.call("sendChatAction", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
      action,
    });
  }

  getFile(fileId: string): Promise<TelegramFileInfo> {
    return this.call("getFile", { file_id: fileId });
  }

  async downloadFile(filePath: string, destinationPath: string): Promise<void> {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    const response = await fetch(`${this.baseUrl}/file/bot${this.token}/${filePath}`);
    if (!response.ok) {
      throw new Error(`Telegram file download failed: HTTP ${response.status}`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(destinationPath, data);
  }

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/bot${this.token}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(removeUndefined(payload)),
    });

    if (!response.ok) {
      throw new Error(`Telegram API ${method} failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as TelegramApiResponse<T>;
    if (!data.ok) {
      throw new TelegramApiError(method, data.description ?? "unknown error", data.error_code, data.parameters);
    }

    return data.result as T;
  }
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
