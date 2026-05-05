import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRunResult, MasterAgentConfig } from "../src/domain/types";
import type { AppSettingsStore } from "../src/electron/settingsStore";
import type { MasterAgent } from "../src/master/MasterAgent";
import { TelegramPollingService } from "../src/telegram/TelegramPollingService";
import type { TelegramNormalizedMessage } from "../src/telegram/TelegramMessageNormalizer";
import type { JsonTelegramStateStore } from "../src/telegram/TelegramStateStore";

describe("TelegramPollingService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits UI events for trusted Telegram messages and agent answers", async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const method = String(input).split("/").at(-1) ?? "";
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ method, body });

      if (method === "getUpdates") {
        return telegramResponse([
          {
            update_id: 100,
            message: {
              message_id: 200,
              date: 1_777_767_600,
              chat: {
                id: "167594257",
                type: "private",
                username: "shatilovm",
              },
              from: {
                id: 167594257,
                is_bot: false,
                first_name: "Михаил",
                username: "shatilovm",
              },
              text: "я не вижу сообщений в открытом приложении",
            },
          },
        ]);
      }

      if (method === "sendChatAction") {
        return telegramResponse(true);
      }

      if (method === "sendMessage") {
        return telegramResponse({ message_id: 201 });
      }

      throw new Error(`Unexpected Telegram method: ${method}`);
    }));

    const receivedMessages: TelegramNormalizedMessage[] = [];
    const progressEvents: string[] = [];
    const answers: string[] = [];
    const order: string[] = [];
    const stateStore = {
      get: vi.fn(async () => ({})),
      set: vi.fn(async (state: { offset?: number }) => {
        order.push(`offset:${state.offset}`);
      }),
    } as unknown as JsonTelegramStateStore;
    const settingsStore = {
      getTelegramSettings: vi.fn(async () => ({
        botToken: "test-token",
        trustedChatId: "167594257",
        pollingMaxIntervalMinutes: 30,
      })),
    } as unknown as AppSettingsStore;
    const masterResult: AgentRunResult = {
      id: "telegram:100:200",
      provider: "codex",
      ok: true,
      exitCode: 0,
      stdout: "Теперь видно.",
      stderr: "",
      startedAt: "2026-05-02T22:03:34.000Z",
      finishedAt: "2026-05-02T22:03:35.000Z",
      durationMs: 1000,
    };
    const master = {
      handleMessage: vi.fn(async (_message: unknown, onProgress?: (event: { phase: string; message: string }) => void) => {
        order.push("master");
        onProgress?.({ phase: "waiting", message: "Waiting for Codex." });
        return masterResult;
      }),
    } as unknown as MasterAgent;
    const config: MasterAgentConfig = {
      defaultProvider: "codex",
      workspaceRoot: "/workspace",
      agents: {},
    };

    const service = new TelegramPollingService({
      settingsStore,
      stateStore,
      filesRoot: "/tmp/telegram-files",
      getMasterAgent: () => master,
      getMasterConfig: () => config,
      onMessageReceived: (message) => receivedMessages.push(message),
      onAgentProgress: (_message, event) => progressEvents.push(event.phase),
      onMessageAnswered: (_message, answer) => answers.push(answer.text),
    });

    const result = await service.pollOnce();

    expect(result.processed).toBe(1);
    expect(result.answered).toBe(1);
    expect(receivedMessages[0]?.incoming).toMatchObject({
      id: "telegram:100:200",
      transport: "telegram",
      text: "я не вижу сообщений в открытом приложении",
    });
    expect(progressEvents).toEqual(["waiting"]);
    expect(answers).toEqual(["Теперь видно."]);
    expect(order.indexOf("offset:101")).toBeLessThan(order.indexOf("master"));
    expect(calls.find((call) => call.method === "sendMessage")?.body).toMatchObject({
      chat_id: "167594257",
      text: "Теперь видно.",
    });
  });

  it("coalesces Telegram media groups before dispatching to the master agent", async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    let getUpdatesCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/file/")) {
        return new Response("file", { status: 200 });
      }

      const method = url.split("/").at(-1) ?? "";
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ method, body });

      if (method === "getUpdates") {
        getUpdatesCalls += 1;
        return telegramResponse(getUpdatesCalls === 1
          ? [
              mediaGroupPhotoUpdate(100, 200, "first", "album-1", "caption"),
              mediaGroupPhotoUpdate(101, 201, "second", "album-1"),
            ]
          : []);
      }

      if (method === "getFile") {
        return telegramResponse({
          file_id: body.file_id,
          file_unique_id: `${String(body.file_id)}-unique`,
          file_path: `photos/${String(body.file_id)}.jpg`,
        });
      }

      if (method === "sendChatAction") {
        return telegramResponse(true);
      }

      if (method === "sendMessage") {
        return telegramResponse({ message_id: 202 });
      }

      throw new Error(`Unexpected Telegram method: ${method}`);
    }));

    const receivedMessages: TelegramNormalizedMessage[] = [];
    const masterInputs: unknown[] = [];
    const stateStore = {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    } as unknown as JsonTelegramStateStore;
    const settingsStore = {
      getTelegramSettings: vi.fn(async () => ({
        botToken: "test-token",
        trustedChatId: "167594257",
        pollingMaxIntervalMinutes: 30,
      })),
    } as unknown as AppSettingsStore;
    const masterResult: AgentRunResult = {
      id: "telegram:100:200",
      provider: "codex",
      ok: true,
      exitCode: 0,
      stdout: "Получил два файла.",
      stderr: "",
      startedAt: "2026-05-02T22:03:34.000Z",
      finishedAt: "2026-05-02T22:03:35.000Z",
      durationMs: 1000,
    };
    const master = {
      handleMessage: vi.fn(async (message: unknown) => {
        masterInputs.push(message);
        return masterResult;
      }),
    } as unknown as MasterAgent;
    const config: MasterAgentConfig = {
      defaultProvider: "codex",
      workspaceRoot: "/workspace",
      agents: {},
    };

    const service = new TelegramPollingService({
      settingsStore,
      stateStore,
      filesRoot: "/tmp/telegram-files",
      getMasterAgent: () => master,
      getMasterConfig: () => config,
      onMessageReceived: (message) => receivedMessages.push(message),
      mediaGroupSettleMs: 0,
    });

    const result = await service.pollOnce();

    expect(result.processed).toBe(2);
    expect(result.answered).toBe(1);
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]?.incoming.text).toContain("Telegram media group: 2 messages, 2 attachments.");
    expect(receivedMessages[0]?.incoming.text).toContain("Caption: caption");
    expect(receivedMessages[0]?.incoming.attachments?.map((attachment) => attachment.id)).toEqual(["first-u", "second-u"]);
    expect(master.handleMessage).toHaveBeenCalledTimes(1);
    expect(masterInputs[0]).toMatchObject({
      attachments: [
        { kind: "photo" },
        { kind: "photo" },
      ],
    });
    expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
  });

  it("handles explicit restart requests without routing them to the master agent", async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const method = String(input).split("/").at(-1) ?? "";
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ method, body });

      if (method === "getUpdates") {
        return telegramResponse([
          {
            update_id: 110,
            message: {
              message_id: 210,
              date: 1_777_767_600,
              chat: {
                id: "167594257",
                type: "private",
                username: "shatilovm",
              },
              from: {
                id: 167594257,
                is_bot: false,
                first_name: "Михаил",
                username: "shatilovm",
              },
              text: "/restart",
            },
          },
        ]);
      }

      if (method === "sendMessage") {
        return telegramResponse({ message_id: 211 });
      }

      throw new Error(`Unexpected Telegram method: ${method}`);
    }));

    const receivedMessages: TelegramNormalizedMessage[] = [];
    const answers: string[] = [];
    const restartRequests: TelegramNormalizedMessage[] = [];
    const stateStore = {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    } as unknown as JsonTelegramStateStore;
    const settingsStore = {
      getTelegramSettings: vi.fn(async () => ({
        botToken: "test-token",
        trustedChatId: "167594257",
        pollingMaxIntervalMinutes: 30,
      })),
    } as unknown as AppSettingsStore;
    const master = {
      handleMessage: vi.fn(),
    } as unknown as MasterAgent;
    const config: MasterAgentConfig = {
      defaultProvider: "codex",
      workspaceRoot: "/workspace",
      agents: {},
    };

    const service = new TelegramPollingService({
      settingsStore,
      stateStore,
      filesRoot: "/tmp/telegram-files",
      getMasterAgent: () => master,
      getMasterConfig: () => config,
      onMessageReceived: (message) => receivedMessages.push(message),
      onMessageAnswered: (_message, answer) => answers.push(answer.text),
      isRestartRequest: (message) => message.incoming.text === "/restart",
      onRestartRequested: (message) => restartRequests.push(message),
    });

    const result = await service.pollOnce();

    expect(result.processed).toBe(1);
    expect(result.answered).toBe(1);
    expect(receivedMessages).toHaveLength(1);
    expect(answers).toEqual(["Перезапускаюсь. Сейчас завершу текущий процесс и поднимусь заново."]);
    expect(restartRequests).toHaveLength(1);
    expect(master.handleMessage).not.toHaveBeenCalled();
    expect(calls.find((call) => call.method === "sendMessage")?.body).toMatchObject({
      chat_id: "167594257",
      text: "Перезапускаюсь. Сейчас завершу текущий процесс и поднимусь заново.",
    });
  });
});

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

function mediaGroupPhotoUpdate(
  updateId: number,
  messageId: number,
  fileId: string,
  mediaGroupId: string,
  caption?: string,
) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      media_group_id: mediaGroupId,
      date: 1_777_767_600,
      chat: {
        id: "167594257",
        type: "private",
        username: "shatilovm",
      },
      from: {
        id: 167594257,
        is_bot: false,
        first_name: "Михаил",
        username: "shatilovm",
      },
      caption,
      photo: [
        {
          file_id: fileId,
          file_unique_id: `${fileId}-u`,
          width: 1000,
          height: 1000,
          file_size: 10000,
        },
      ],
    },
  };
}
