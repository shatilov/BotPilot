import { describe, expect, it } from "vitest";
import type { TelegramBotClient } from "../src/telegram/TelegramBotClient";
import { normalizeTelegramUpdate } from "../src/telegram/TelegramMessageNormalizer";
import type { TelegramUpdate } from "../src/telegram/types";

class FakeTelegramClient {
  fileIds: string[] = [];
  downloads: Array<{ filePath: string; destinationPath: string }> = [];

  async getFile(fileId: string) {
    this.fileIds.push(fileId);
    return {
      file_id: fileId,
      file_unique_id: `${fileId}-unique`,
      file_path: `photos/${fileId}.jpg`,
    };
  }

  async downloadFile(filePath: string, destinationPath: string) {
    this.downloads.push({ filePath, destinationPath });
  }
}

describe("normalizeTelegramUpdate", () => {
  it("normalizes trusted text messages", async () => {
    const update: TelegramUpdate = {
      update_id: 10,
      message: {
        message_id: 20,
        date: 1_775_256_000,
        chat: { id: 123, type: "private" },
        from: { id: 456, first_name: "User" },
        text: "hello",
      },
    };

    const result = await normalizeTelegramUpdate(update, {
      client: new FakeTelegramClient() as unknown as TelegramBotClient,
      trustedChatId: "123",
      filesRoot: "/tmp/telegram-files",
    });

    expect(result.kind).toBe("message");
    if (result.kind === "message") {
      expect(result.message.incoming.text).toBe("hello");
      expect(result.message.incoming.chatId).toBe("123");
      expect(result.message.replyToMessageId).toBe(20);
    }
  });

  it("ignores untrusted chats", async () => {
    const result = await normalizeTelegramUpdate({
      update_id: 10,
      message: {
        message_id: 20,
        chat: { id: 999, type: "private" },
        text: "hello",
      },
    }, {
      client: new FakeTelegramClient() as unknown as TelegramBotClient,
      trustedChatId: "123",
      filesRoot: "/tmp/telegram-files",
    });

    expect(result).toEqual({ kind: "ignored", reason: "untrusted chat 999" });
  });

  it("downloads the largest photo and keeps the caption as task context", async () => {
    const client = new FakeTelegramClient();
    const result = await normalizeTelegramUpdate({
      update_id: 11,
      message: {
        message_id: 21,
        chat: { id: 123, type: "private" },
        caption: "what is in this image?",
        photo: [
          { file_id: "small", file_unique_id: "small-u", width: 100, height: 100, file_size: 1000 },
          { file_id: "large", file_unique_id: "large-u", width: 1000, height: 1000, file_size: 10000 },
        ],
      },
    }, {
      client: client as unknown as TelegramBotClient,
      trustedChatId: "123",
      filesRoot: "/tmp/telegram-files",
    });

    expect(result.kind).toBe("message");
    expect(client.fileIds).toEqual(["large"]);
    expect(client.downloads[0]?.destinationPath).toContain("/tmp/telegram-files/123/11-21-photo-large-u.jpg");
    if (result.kind === "message") {
      expect(result.message.incoming.text).toContain("Caption: what is in this image?");
      expect(result.message.incoming.attachments?.[0]?.kind).toBe("photo");
      expect(result.message.incoming.attachments?.[0]?.localPath).toContain("11-21-photo-large-u.jpg");
    }
  });

  it("turns non-file Telegram content into a non-empty task", async () => {
    const result = await normalizeTelegramUpdate({
      update_id: 12,
      message: {
        message_id: 22,
        chat: { id: 123, type: "private" },
        contact: {
          phone_number: "+100000",
          first_name: "Contact",
        },
      },
    }, {
      client: new FakeTelegramClient() as unknown as TelegramBotClient,
      trustedChatId: "123",
      filesRoot: "/tmp/telegram-files",
    });

    expect(result.kind).toBe("message");
    if (result.kind === "message") {
      expect(result.message.incoming.text).toContain("contact");
    }
  });

  it("downloads media nested inside paid media payloads", async () => {
    const client = new FakeTelegramClient();
    const result = await normalizeTelegramUpdate({
      update_id: 13,
      message: {
        message_id: 23,
        chat: { id: 123, type: "private" },
        paid_media: {
          paid_media: [
            {
              type: "photo",
              photo: [
                { file_id: "paid-small", file_unique_id: "paid-small-u", width: 10, height: 10 },
                { file_id: "paid-large", file_unique_id: "paid-large-u", width: 100, height: 100 },
              ],
            },
            {
              type: "video",
              video: { file_id: "paid-video", file_unique_id: "paid-video-u" },
            },
          ],
        },
      },
    }, {
      client: client as unknown as TelegramBotClient,
      trustedChatId: "123",
      filesRoot: "/tmp/telegram-files",
    });

    expect(result.kind).toBe("message");
    expect(client.fileIds).toEqual(["paid-large", "paid-video"]);
    if (result.kind === "message") {
      expect(result.message.incoming.attachments?.map((attachment) => attachment.kind)).toEqual(["photo", "video"]);
    }
  });
});
