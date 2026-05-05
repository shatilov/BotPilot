import type { AgentProgressEvent, AgentRunResult, IncomingAttachment, MasterAgentConfig } from "../domain/types";
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
  onMessageReceived?: (message: TelegramNormalizedMessage) => void | Promise<void>;
  onAgentProgress?: (message: TelegramNormalizedMessage, event: AgentProgressEvent) => void | Promise<void>;
  onMessageAnswered?: (message: TelegramNormalizedMessage, answer: TelegramAnswerEvent) => void | Promise<void>;
  isRestartRequest?: (message: TelegramNormalizedMessage) => boolean;
  onRestartRequested?: (message: TelegramNormalizedMessage) => void | Promise<void>;
  mediaGroupSettleMs?: number;
  mediaGroupMaxWaitMs?: number;
}

export interface TelegramAnswerEvent {
  text: string;
  ok: boolean;
  provider?: string;
  durationMs?: number;
  exitCode?: number | null;
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
const TELEGRAM_MEDIA_GROUP_SETTLE_MS = 1_200;
const TELEGRAM_MEDIA_GROUP_MAX_WAIT_MS = 6_000;
const TELEGRAM_MEDIA_GROUP_MAX_ITEMS = 10;
const RESTART_ACK_TEXT = "Перезапускаюсь. Сейчас завершу текущий процесс и поднимусь заново.";

interface PendingMediaGroup {
  key: string;
  mediaGroupId: string;
  messages: TelegramNormalizedMessage[];
  firstSeenAt: number;
  lastUpdatedAt: number;
}

export class TelegramPollingService {
  private cadence: TelegramPollingCadence | undefined;
  private readonly pendingMediaGroups = new Map<string, PendingMediaGroup>();

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

    const result = await this.processUpdates(updates, client, settings, state.offset, state.lastAnsweredAt);
    await this.collectSettledMediaGroups(client, settings, result, state.lastAnsweredAt);
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
    lastAnsweredAt: string | undefined,
  ): Promise<Omit<TelegramPollingResult, "configured" | "nextIntervalMs">> {
    const result: Omit<TelegramPollingResult, "configured" | "nextIntervalMs"> = {
      fetched: updates.length,
      processed: 0,
      ignored: 0,
      answered: 0,
      lastOffset: initialOffset,
    };

    await this.processUpdateBatch(updates, client, settings, result, lastAnsweredAt);
    await this.flushReadyMediaGroups(client, result, Date.now());

    return result;
  }

  private async processUpdateBatch(
    updates: TelegramUpdate[],
    client: TelegramBotClient,
    settings: TelegramSettings,
    result: Omit<TelegramPollingResult, "configured" | "nextIntervalMs">,
    lastAnsweredAt: string | undefined,
  ): Promise<void> {
    for (const update of updates) {
      result.lastOffset = Math.max(result.lastOffset ?? 0, update.update_id + 1);
      await this.options.stateStore.set({
        offset: result.lastOffset,
        lastAnsweredAt,
      });

      const normalized = await normalizeTelegramUpdate(update, {
        client,
        trustedChatId: settings.trustedChatId ?? "",
        filesRoot: this.options.filesRoot,
      });

      if (normalized.kind === "ignored") {
        result.ignored += 1;
        continue;
      }

      result.processed += 1;
      await this.queueOrDispatchMessage(client, normalized.message, result);
    }
  }

  private async collectSettledMediaGroups(
    client: TelegramBotClient,
    settings: TelegramSettings,
    result: Omit<TelegramPollingResult, "configured" | "nextIntervalMs">,
    lastAnsweredAt: string | undefined,
  ): Promise<void> {
    while (this.pendingMediaGroups.size > 0) {
      const waitMs = this.nextMediaGroupWaitMs(Date.now());
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      const updates = await client.getUpdates({
        offset: result.lastOffset,
        limit: 100,
        timeout: 0,
        allowedUpdates: TELEGRAM_ALLOWED_UPDATES,
      });

      result.fetched += updates.length;
      await this.processUpdateBatch(updates, client, settings, result, lastAnsweredAt);
      await this.flushReadyMediaGroups(client, result, Date.now());

      if (updates.length === 0 && this.noPendingGroupNeedsMoreWait(Date.now())) {
        break;
      }
    }
  }

  private async queueOrDispatchMessage(
    client: TelegramBotClient,
    message: TelegramNormalizedMessage,
    result: Omit<TelegramPollingResult, "configured" | "nextIntervalMs">,
  ): Promise<void> {
    const mediaGroupId = getTelegramMediaGroupId(message);
    if (!mediaGroupId) {
      await this.dispatchMessage(client, message, result);
      return;
    }

    const now = Date.now();
    const key = buildMediaGroupKey(message, mediaGroupId);
    const group = this.pendingMediaGroups.get(key) ?? {
      key,
      mediaGroupId,
      messages: [],
      firstSeenAt: now,
      lastUpdatedAt: now,
    };

    group.messages.push(message);
    group.lastUpdatedAt = now;
    this.pendingMediaGroups.set(key, group);
  }

  private async flushReadyMediaGroups(
    client: TelegramBotClient,
    result: Omit<TelegramPollingResult, "configured" | "nextIntervalMs">,
    now: number,
  ): Promise<void> {
    const readyGroups = [...this.pendingMediaGroups.values()].filter((group) => this.isMediaGroupReady(group, now));
    for (const group of readyGroups) {
      this.pendingMediaGroups.delete(group.key);
      await this.dispatchMessage(client, mergeMediaGroupMessages(group), result);
    }
  }

  private async dispatchMessage(
    client: TelegramBotClient,
    message: TelegramNormalizedMessage,
    result: Omit<TelegramPollingResult, "configured" | "nextIntervalMs">,
  ): Promise<void> {
    if (this.options.isRestartRequest?.(message)) {
      await this.options.onMessageReceived?.(message);
      await this.options.onMessageAnswered?.(message, { text: RESTART_ACK_TEXT, ok: true, provider: "botpilot" });
      const didAnswer = await this.trySendTelegramText(client, message, RESTART_ACK_TEXT);
      if (didAnswer) {
        result.answered += 1;
      }
      await this.options.onRestartRequested?.(message);
      return;
    }

    await this.options.onMessageReceived?.(message);
    const didAnswer = await this.answerMessage(client, message);
    if (didAnswer) {
      result.answered += 1;
    }
  }

  private isMediaGroupReady(group: PendingMediaGroup, now: number): boolean {
    return (
      group.messages.length >= TELEGRAM_MEDIA_GROUP_MAX_ITEMS ||
      now - group.lastUpdatedAt >= this.mediaGroupSettleMs() ||
      now - group.firstSeenAt >= this.mediaGroupMaxWaitMs()
    );
  }

  private nextMediaGroupWaitMs(now: number): number {
    const waits = [...this.pendingMediaGroups.values()].map((group) => {
      if (group.messages.length >= TELEGRAM_MEDIA_GROUP_MAX_ITEMS) {
        return 0;
      }
      const settleRemaining = this.mediaGroupSettleMs() - (now - group.lastUpdatedAt);
      const maxRemaining = this.mediaGroupMaxWaitMs() - (now - group.firstSeenAt);
      return Math.max(0, Math.min(settleRemaining, maxRemaining));
    });

    return waits.length ? Math.min(...waits) : 0;
  }

  private noPendingGroupNeedsMoreWait(now: number): boolean {
    return [...this.pendingMediaGroups.values()].every((group) => this.isMediaGroupReady(group, now));
  }

  private mediaGroupSettleMs(): number {
    return this.options.mediaGroupSettleMs ?? TELEGRAM_MEDIA_GROUP_SETTLE_MS;
  }

  private mediaGroupMaxWaitMs(): number {
    return this.options.mediaGroupMaxWaitMs ?? TELEGRAM_MEDIA_GROUP_MAX_WAIT_MS;
  }

  private async answerMessage(
    client: TelegramBotClient,
    message: TelegramNormalizedMessage,
  ): Promise<boolean> {
    const masterAgent = this.options.getMasterAgent();
    const masterConfig = this.options.getMasterConfig();
    if (!masterAgent || !masterConfig) {
      const text = "Master agent is not initialized yet.";
      await this.options.onMessageAnswered?.(message, { text, ok: false });
      return this.trySendTelegramText(client, message, text);
    }

    let typingTimer: NodeJS.Timeout | undefined;
    try {
      await this.safeSendChatAction(client, message);
      typingTimer = setInterval(() => {
        void this.safeSendChatAction(client, message);
      }, 4_000);
      typingTimer.unref();

      const result = await masterAgent.handleMessage(
        {
          ...message.incoming,
          routing: {
            provider: masterConfig.defaultProvider,
            cwd: masterConfig.workspaceRoot,
          },
        },
        (event) => {
          void this.options.onAgentProgress?.(message, event);
        },
      );

      const output = result.stdout.trim() || result.stderr.trim() || (result.ok ? "Готово." : "Не удалось получить ответ от агента.");
      const text = result.ok ? output : `Ошибка агента:\n${output}`;
      await this.options.onMessageAnswered?.(message, toTelegramAnswerEvent(result, text));
      return this.trySendTelegramText(client, message, text);
    } catch (error) {
      const text = `Ошибка обработки сообщения:\n${error instanceof Error ? error.message : String(error)}`;
      await this.options.onMessageAnswered?.(message, { text, ok: false });
      return this.trySendTelegramText(client, message, text);
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

function toTelegramAnswerEvent(result: AgentRunResult, text: string): TelegramAnswerEvent {
  return {
    text,
    ok: result.ok,
    provider: result.provider,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
  };
}

function getTelegramMediaGroupId(message: TelegramNormalizedMessage): string | undefined {
  const telegram = getTelegramMetadata(message);
  const mediaGroupId = telegram?.mediaGroupId;
  return typeof mediaGroupId === "string" && mediaGroupId.trim() ? mediaGroupId : undefined;
}

function buildMediaGroupKey(message: TelegramNormalizedMessage, mediaGroupId: string): string {
  const chatId = String(message.replyChatId);
  const threadId = message.messageThreadId === undefined ? "" : String(message.messageThreadId);
  return `${chatId}:${threadId}:${mediaGroupId}`;
}

function mergeMediaGroupMessages(group: PendingMediaGroup): TelegramNormalizedMessage {
  const messages = group.messages.slice().sort((left, right) => getTelegramMessageId(left) - getTelegramMessageId(right));
  const first = messages[0];
  const attachments = messages.flatMap((message) => message.incoming.attachments ?? []);
  const captions = unique(messages.map((message) => extractCaption(message.incoming.text)).filter(Boolean));
  const contentTypes = unique(messages.flatMap((message) => getTelegramContentTypes(message)));

  return {
    ...first,
    incoming: {
      ...first.incoming,
      id: `${first.incoming.id}:media-group:${group.mediaGroupId}`,
      text: buildMediaGroupText(messages.length, attachments, captions),
      attachments,
      metadata: {
        ...first.incoming.metadata,
        telegram: {
          ...getTelegramMetadata(first),
          mediaGroupId: group.mediaGroupId,
          groupedMessageCount: messages.length,
          contentTypes,
          messageIds: messages.map(getTelegramMessageId).filter((id) => id > 0),
          updateIds: messages.map(getTelegramUpdateId).filter((id) => id > 0),
        },
      },
    },
    replyToMessageId: first.replyToMessageId,
  };
}

function buildMediaGroupText(messageCount: number, attachments: IncomingAttachment[], captions: string[]): string {
  const lines = [`Telegram media group: ${messageCount} messages, ${attachments.length} attachments.`];
  for (const caption of captions) {
    lines.push(captions.length === 1 ? `Caption: ${caption}` : `Caption ${lines.length}: ${caption}`);
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

function extractCaption(text: string): string | undefined {
  const captionLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("Caption:"));
  return captionLine?.slice("Caption:".length).trim() || undefined;
}

function getTelegramMetadata(message: TelegramNormalizedMessage): Record<string, unknown> | undefined {
  const metadata = message.incoming.metadata?.telegram;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : undefined;
}

function getTelegramContentTypes(message: TelegramNormalizedMessage): string[] {
  const contentTypes = getTelegramMetadata(message)?.contentTypes;
  return Array.isArray(contentTypes) ? contentTypes.filter((entry): entry is string => typeof entry === "string") : [];
}

function getTelegramMessageId(message: TelegramNormalizedMessage): number {
  const messageId = getTelegramMetadata(message)?.messageId;
  return typeof messageId === "number" ? messageId : 0;
}

function getTelegramUpdateId(message: TelegramNormalizedMessage): number {
  const updateId = getTelegramMetadata(message)?.updateId;
  return typeof updateId === "number" ? updateId : 0;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
