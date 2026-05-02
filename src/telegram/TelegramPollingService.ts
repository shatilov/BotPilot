import type { MasterAgentConfig } from "../domain/types";
import type { AppSettingsStore, TelegramSettings } from "../electron/settingsStore";
import type { MasterAgent } from "../master/MasterAgent";
import { TelegramBotClient } from "./TelegramBotClient";
import { normalizeTelegramUpdate, type TelegramNormalizedMessage } from "./TelegramMessageNormalizer";
import { TelegramPollingCadence } from "./TelegramPollingCadence";
import type { JsonTelegramStateStore } from "./TelegramStateStore";
import type { TelegramUpdate } from "./types";

export interface TelegramPollingServiceOptions {
  settingsStore: AppSettingsStore;
  stateStore: JsonTelegramStateStore;
  filesRoot: string;
  getMasterAgent: () => MasterAgent | undefined;
  getMasterConfig: () => MasterAgentConfig | undefined;
}

export interface TelegramPollingResult {
  configured: boolean;
  fetched: number;
  processed: number;
  ignored: number;
  answered: number;
  nextIntervalMs: number;
  lastOffset?: number;
}

const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "business_message",
  "edited_business_message",
  "callback_query",
  "poll",
  "poll_answer",
  "my_chat_member",
  "chat_member",
  "message_reaction",
  "message_reaction_count",
];

const TELEGRAM_REPLY_CHUNK_SIZE = 3900;

export class TelegramPollingService {
  private cadence: TelegramPollingCadence | undefined;

  constructor(private readonly options: TelegramPollingServiceOptions) {}

  async pollOnce(): Promise<TelegramPollingResult> {
    const settings = await this.options.settingsStore.getTelegramSettings();
    const maxIntervalMs = settings.pollingMaxIntervalMinutes * 60_000;
    const state = await this.options.stateStore.get();
    this.cadence ??= new TelegramPollingCadence(state.lastAnsweredAt);

    if (!settings.botToken || !settings.trustedChatId) {
      return {
        configured: false,
        fetched: 0,
        processed: 0,
        ignored: 0,
        answered: 0,
        nextIntervalMs: maxIntervalMs,
        lastOffset: state.offset,
      };
    }

    const client = new TelegramBotClient(settings.botToken);
    const updates = await client.getUpdates({
      offset: state.offset,
      limit: 100,
      timeout: 0,
      allowedUpdates: TELEGRAM_ALLOWED_UPDATES,
    });

    const result = await this.processUpdates(updates, client, settings, state.offset);
    if (result.answered > 0) {
      const lastAnsweredAt = this.cadence.markAnswered();
      await this.options.stateStore.set({
        offset: result.lastOffset,
        lastAnsweredAt,
      });
    } else {
      await this.options.stateStore.set({
        offset: result.lastOffset,
        lastAnsweredAt: state.lastAnsweredAt,
      });
    }

    return {
      ...result,
      configured: true,
      nextIntervalMs: this.cadence.nextIntervalMs(maxIntervalMs),
    };
  }

  private async processUpdates(
    updates: TelegramUpdate[],
    client: TelegramBotClient,
    settings: TelegramSettings,
    initialOffset: number | undefined,
  ): Promise<Omit<TelegramPollingResult, "configured" | "nextIntervalMs">> {
    let processed = 0;
    let ignored = 0;
    let answered = 0;
    let lastOffset = initialOffset;

    for (const update of updates) {
      lastOffset = Math.max(lastOffset ?? 0, update.update_id + 1);
      const normalized = await normalizeTelegramUpdate(update, {
        client,
        trustedChatId: settings.trustedChatId ?? "",
        filesRoot: this.options.filesRoot,
      });

      if (normalized.kind === "ignored") {
        ignored += 1;
        continue;
      }

      processed += 1;
      const didAnswer = await this.answerMessage(client, normalized.message);
      if (didAnswer) {
        answered += 1;
      }
    }

    return {
      fetched: updates.length,
      processed,
      ignored,
      answered,
      lastOffset,
    };
  }

  private async answerMessage(
    client: TelegramBotClient,
    message: TelegramNormalizedMessage,
  ): Promise<boolean> {
    const masterAgent = this.options.getMasterAgent();
    const masterConfig = this.options.getMasterConfig();
    if (!masterAgent || !masterConfig) {
      return this.trySendTelegramText(client, message, "Master agent is not initialized yet.");
    }

    let typingTimer: NodeJS.Timeout | undefined;
    try {
      await this.safeSendChatAction(client, message);
      typingTimer = setInterval(() => {
        void this.safeSendChatAction(client, message);
      }, 4_000);
      typingTimer.unref();

      const result = await masterAgent.handleMessage({
        ...message.incoming,
        routing: {
          provider: masterConfig.defaultProvider,
          cwd: masterConfig.workspaceRoot,
        },
      });

      const output = result.stdout.trim() || result.stderr.trim() || (result.ok ? "Готово." : "Не удалось получить ответ от агента.");
      return this.trySendTelegramText(client, message, result.ok ? output : `Ошибка агента:\n${output}`);
    } catch (error) {
      return this.trySendTelegramText(client, message, `Ошибка обработки сообщения:\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (typingTimer) {
        clearInterval(typingTimer);
      }
    }
  }

  private async safeSendChatAction(
    client: TelegramBotClient,
    message: TelegramNormalizedMessage,
  ): Promise<void> {
    try {
      await client.sendChatAction(message.replyChatId, "typing", message.messageThreadId);
    } catch {
      // Chat actions are best-effort; failing to show typing must not fail the task.
    }
  }

  private async sendTelegramText(
    client: TelegramBotClient,
    message: TelegramNormalizedMessage,
    text: string,
  ): Promise<void> {
    const chunks = splitTelegramText(text);
    for (let index = 0; index < chunks.length; index += 1) {
      await client.sendMessage({
        chatId: message.replyChatId,
        text: chunks[index],
        messageThreadId: message.messageThreadId,
        replyToMessageId: index === 0 ? message.replyToMessageId : undefined,
      });
    }
  }

  private async trySendTelegramText(
    client: TelegramBotClient,
    message: TelegramNormalizedMessage,
    text: string,
  ): Promise<boolean> {
    try {
      await this.sendTelegramText(client, message, text);
      return true;
    } catch {
      return false;
    }
  }
}

function splitTelegramText(text: string): string[] {
  const normalized = text.trim() || "Готово.";
  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += TELEGRAM_REPLY_CHUNK_SIZE) {
    chunks.push(normalized.slice(index, index + TELEGRAM_REPLY_CHUNK_SIZE));
  }
  return chunks;
}
