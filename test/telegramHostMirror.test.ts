import { describe, expect, it, vi } from "vitest";
import { formatHostMessageMirror, sendHostMessageMirror, sendTelegramText } from "../src/telegram/telegramHostMirror";

describe("telegram host mirror", () => {
  it("formats host messages as a Telegram quote", () => {
    expect(formatHostMessageMirror("первая строка\nвторая строка")).toBe(
      "Вы написали на хосте:\n\n> первая строка\n> вторая строка",
    );
  });

  it("sends formatted host messages to the trusted Telegram chat", async () => {
    const sendMessage = vi.fn(async () => ({}));

    await sendHostMessageMirror({ sendMessage }, {
      chatId: "167594257",
      text: "текст из окна",
    });

    expect(sendMessage).toHaveBeenCalledWith({
      chatId: "167594257",
      text: "Вы написали на хосте:\n\n> текст из окна",
    });
  });

  it("sends plain mirrored agent text to the trusted Telegram chat", async () => {
    const sendMessage = vi.fn(async () => ({}));

    await sendTelegramText({ sendMessage }, {
      chatId: "167594257",
      text: "ответ агента",
    });

    expect(sendMessage).toHaveBeenCalledWith({
      chatId: "167594257",
      text: "ответ агента",
    });
  });
});
