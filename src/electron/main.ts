import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import { CodexMcpAdapter } from "../agents/CodexMcpAdapter";
import { CodexMcpClient } from "../agents/CodexMcpClient";
import { createAdapters } from "../agents/createAdapters";
import { defaultConfig } from "../config/defaultConfig";
import { isExplicitRestartRequest } from "../control/restartRequest";
import type { CodexAgentConfig, IncomingMessage, MasterAgentConfig } from "../domain/types";
import { JsonDialogStore } from "../master/DialogStore";
import { MasterAgent } from "../master/MasterAgent";
import { TelegramBotClient } from "../telegram/TelegramBotClient";
import { TelegramPollingService } from "../telegram/TelegramPollingService";
import { JsonTelegramStateStore } from "../telegram/TelegramStateStore";
import { sendHostMessageMirror, sendTelegramText } from "../telegram/telegramHostMirror";
import { BackgroundRuntime } from "./backgroundRuntime";
import { JsonlChatTranscriptStore } from "./ChatTranscriptStore";
import type { ChatAttachmentTranscript, ChatMessageAttachment, ChatMessageEvent } from "./chatEvents";
import { renderChatPage } from "./chatPage";
import { resolveCommand } from "./commandResolver";
import { renderSettingsPage } from "./settingsPage";
import { AppSettingsStore, DEFAULT_TELEGRAM_POLLING_MAX_INTERVAL_MINUTES, type TelegramSettingsUpdate } from "./settingsStore";
import { TrayController } from "./trayController";
import { CommandVoiceTranscriber, enrichVoiceTranscripts } from "./voiceTranscription";

let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let isQuitting = false;
let masterAgent: MasterAgent | undefined;
let masterConfig: MasterAgentConfig | undefined;
let codexMcpClient: CodexMcpClient | undefined;
let settingsStore: AppSettingsStore | undefined;
let telegramPollingService: TelegramPollingService | undefined;
let chatTranscriptStore: JsonlChatTranscriptStore | undefined;
let telegramFilesRoot: string | undefined;
let mediaProtocolRegistered = false;
const chatHistory: ChatMessageEvent[] = [];
const CHAT_HISTORY_LIMIT = 200;
const voiceTranscriber = new CommandVoiceTranscriber();
const RESTART_ACK_TEXT = "Перезапускаюсь. Сейчас завершу текущий процесс и поднимусь заново.";
const RESTART_DELAY_MS = 750;
let restartScheduled = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "assyst-media",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

const runtime = new BackgroundRuntime(readBackgroundIntervalMs(), {
  onTick: async () => {
    const result = await telegramPollingService?.pollOnce();
    return {
      nextIntervalMs: result?.nextIntervalMs,
      metadata: result
        ? {
            transport: "telegram",
            configured: result.configured,
            fetched: result.fetched,
            processed: result.processed,
            ignored: result.ignored,
            answered: result.answered,
            lastOffset: result.lastOffset,
          }
        : {
            transport: "telegram",
            configured: false,
          },
    };
  },
});
const trayController = new TrayController({
  getWindow: () => mainWindow,
  createWindow,
  openSettingsWindow: createSettingsWindow,
  runtime,
  quit: () => {
    isQuitting = true;
    runtime.stop();
    void codexMcpClient?.stop();
    trayController.destroy();
    app.quit();
  },
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void createWindow().then((window) => {
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
      window.focus();
    });
  });
}

async function createWindow(): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    title: "BotPilot",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderChatPage())}`);

  return mainWindow;
}

async function createSettingsWindow(): Promise<BrowserWindow> {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 540,
    height: 470,
    title: "BotPilot Settings",
    show: true,
    resizable: false,
    minimizable: false,
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
  });

  await settingsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderSettingsPage())}`);

  return settingsWindow;
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    if (process.platform === "darwin") {
      app.dock?.hide();
    }

    settingsStore = new AppSettingsStore(path.join(app.getPath("userData"), "settings.json"));
    chatTranscriptStore = new JsonlChatTranscriptStore(path.join(app.getPath("userData"), "chat-transcript.jsonl"));
    telegramFilesRoot = path.join(app.getPath("userData"), "telegram-files");
    registerAssystMediaProtocol(telegramFilesRoot);
    await loadChatHistory();
    telegramPollingService = new TelegramPollingService({
      settingsStore,
      stateStore: new JsonTelegramStateStore(path.join(app.getPath("userData"), "telegram-state.json")),
      filesRoot: telegramFilesRoot,
      getMasterAgent: () => masterAgent,
      getMasterConfig: () => masterConfig,
      onMessageReceived: async (message) => {
        await enrichVoiceTranscripts(message.incoming, voiceTranscriber);
        await publishChatMessage({
          eventId: randomUUID(),
          requestId: message.incoming.id,
          role: message.incoming.senderName || "telegram",
          kind: "user",
          text: buildTelegramMessageDisplayText(message.incoming),
          timestamp: message.incoming.receivedAt,
          meta: buildTelegramMessageMeta(message.incoming),
          attachments: buildChatMessageAttachments(message.incoming),
        });
      },
      onAgentProgress: (message, progress) => {
        publishRunEvent({
          requestId: message.incoming.id,
          provider: masterConfig?.defaultProvider,
          phase: progress.phase,
          message: progress.message,
          timestamp: progress.timestamp ?? new Date().toISOString(),
          metadata: progress.metadata,
        });
      },
      onMessageAnswered: async (message, answer) => {
        await publishChatMessage({
          eventId: randomUUID(),
          requestId: message.incoming.id,
          role: "master",
          kind: answer.ok ? "assistant" : "error",
          text: answer.text,
          timestamp: new Date().toISOString(),
          meta: [
            answer.provider ?? masterConfig?.defaultProvider ?? "agent",
            answer.ok ? "ok" : "failed",
            ...(typeof answer.durationMs === "number" ? [String(answer.durationMs) + "ms"] : []),
            ...(answer.exitCode !== undefined ? ["exit: " + String(answer.exitCode)] : []),
          ],
        });
      },
      isRestartRequest: (message) => isExplicitRestartRequest(message.incoming.text),
      onRestartRequested: (message) => scheduleSafeRestart(`telegram:${message.replyChatId}`),
    });
    runtime.start();
    setupMasterAgent();
    setupIpcHandlers();
    trayController.create();
    setInterval(() => trayController.updateMenu(), 15_000).unref();
    await createWindow();
  }).catch((error: unknown) => {
    console.error(error);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  mainWindow = undefined;
});

app.on("activate", () => {
  if (!mainWindow) {
    void createWindow();
    return;
  }

  mainWindow.show();
});

app.on("before-quit", () => {
  isQuitting = true;
  runtime.stop();
  void codexMcpClient?.stop();
  trayController.destroy();
});

function readBackgroundIntervalMs(): number {
  const raw = process.env.BOTPILOT_BACKGROUND_INTERVAL_MS ?? process.env.ASSYST_BACKGROUND_INTERVAL_MS;
  if (!raw) {
    return DEFAULT_TELEGRAM_POLLING_MAX_INTERVAL_MINUTES * 60_000;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TELEGRAM_POLLING_MAX_INTERVAL_MINUTES * 60_000;
}

function setupMasterAgent(): void {
  const workspaceRoot = app.getAppPath();
  const dialogStore = new JsonDialogStore(path.join(app.getPath("userData"), "dialogs.json"));
  const codexChatsMcpPath = path.join(__dirname, "..", "mcp", "codexChatsServer.js");
  const baseCodexConfig = defaultConfig.agents.codex;
  const baseClaudeConfig = defaultConfig.agents.claude;
  if (baseCodexConfig.type !== "codex" || baseClaudeConfig.type !== "claude") {
    throw new Error("Default agent config is invalid");
  }

  const codexConfig: CodexAgentConfig = {
    ...baseCodexConfig,
    bin: resolveCommand(baseCodexConfig.bin ?? "codex"),
    sandbox: "danger-full-access",
    developerInstructions: [
      "You have BotPilot MCP tools for local Codex data.",
      "Use list_codex_chats when the user asks for Codex chats, sessions, threads, or conversation history.",
      "Use get_codex_chat only for a specific chat id or when the user clearly asks to inspect a selected chat.",
      "Use list_codex_projects when the user asks for Codex projects or trusted workspaces.",
      "Do not expose secrets from transcripts; summarize sensitive content instead of quoting it.",
    ].join("\n"),
    config: {
      mcp_servers: {
        botpilot_codex_chats: {
          command: resolveCommand("node"),
          args: [codexChatsMcpPath],
        },
      },
    },
  };

  const config: MasterAgentConfig = {
    ...defaultConfig,
    workspaceRoot,
    agents: {
      codex: codexConfig,
      claude: {
        ...baseClaudeConfig,
        bin: resolveCommand(baseClaudeConfig.bin ?? "claude"),
      },
      echo: {
        type: "command",
        command: resolveCommand("node"),
        args: ["-e", "process.stdin.pipe(process.stdout)"],
        promptDelivery: "stdin",
      },
    },
  };

  masterConfig = config;
  const adapters = createAdapters(config);
  codexMcpClient = new CodexMcpClient({
    command: codexConfig.bin ?? "codex",
    args: ["mcp-server"],
    cwd: workspaceRoot,
    env: codexConfig.env,
  });
  adapters.set("codex", new CodexMcpAdapter(codexConfig, {
    client: codexMcpClient,
    dialogId: "master:codex",
    dialogVersion: "codex-mcp+botpilot-codex-chats-v1",
    store: dialogStore,
  }));

  masterAgent = new MasterAgent(config, adapters);
}

function setupIpcHandlers(): void {
  ipcMain.handle("assyst:get-settings", () => {
    ensureMasterReady();
    return {
      defaultProvider: masterConfig?.defaultProvider,
      providers: Object.keys(masterConfig?.agents ?? {}),
      workspaceRoot: masterConfig?.workspaceRoot,
    };
  });

  ipcMain.handle("assyst:get-chat-history", () => chatHistory);

  ipcMain.handle("assyst:open-settings", async () => {
    await createSettingsWindow();
  });

  ipcMain.handle("assyst:get-telegram-settings", async () => {
    return getSettingsStore().getTelegramSettingsView();
  });

  ipcMain.handle("assyst:save-telegram-settings", async (_event, payload: unknown) => {
    return getSettingsStore().updateTelegramSettings(parseTelegramSettingsUpdate(payload));
  });

  ipcMain.handle("assyst:send-message", async (_event, payload: unknown) => {
    ensureMasterReady();
    const request = parseSendPayload(payload);
    const requestId = request.requestId ?? randomUUID();
    const message: IncomingMessage = {
      id: requestId,
      transport: "electron-chat",
      text: request.text,
      receivedAt: new Date().toISOString(),
      routing: {
        provider: request.provider,
        cwd: request.cwd ?? masterConfig?.workspaceRoot,
      },
    };

    const provider = request.provider ?? masterConfig?.defaultProvider ?? "agent";
    await publishChatMessage({
      eventId: randomUUID(),
      requestId,
      role: "host",
      kind: "user",
      text: request.text,
      timestamp: message.receivedAt,
      meta: [provider, "host"],
    });

    await mirrorHostMessageToTelegram(request.text, requestId);

    if (isExplicitRestartRequest(request.text)) {
      const result = buildControlRunResult(requestId, provider, RESTART_ACK_TEXT);
      await mirrorTextToTelegram(RESTART_ACK_TEXT, requestId, "telegram-restart-mirror-failed");
      await publishChatMessage({
        eventId: randomUUID(),
        requestId,
        role: "master",
        kind: "assistant",
        text: RESTART_ACK_TEXT,
        timestamp: result.finishedAt,
        meta: [provider, "restart scheduled"],
      });
      scheduleSafeRestart("electron-chat");
      return result;
    }

    publishRunEvent({
      requestId,
      provider,
      phase: "received",
      message: "Request received by BotPilot.",
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await masterAgent!.handleMessage(message, (progress) => {
        publishRunEvent({
          requestId,
          provider,
          phase: progress.phase,
          message: progress.message,
          timestamp: progress.timestamp ?? new Date().toISOString(),
          metadata: progress.metadata,
        });
      });
      const output = result.stdout.trim() || result.stderr.trim() || (result.ok ? "Done" : "No output");
      await mirrorTextToTelegram(output, requestId, "telegram-answer-mirror-failed");
      await publishChatMessage({
        eventId: randomUUID(),
        requestId,
        role: "master",
        kind: result.ok ? "assistant" : "error",
        text: output,
        timestamp: new Date().toISOString(),
        meta: [
          result.provider,
          result.ok ? "ok" : "failed",
          String(result.durationMs) + "ms",
          "exit: " + String(result.exitCode),
        ],
      });
      return result;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await publishChatMessage({
        eventId: randomUUID(),
        requestId,
        role: "master",
        kind: "error",
        text,
        timestamp: new Date().toISOString(),
        meta: [provider, "failed"],
      });
      throw error;
    }
  });
}

function scheduleSafeRestart(reason: string): void {
  if (restartScheduled) {
    return;
  }

  restartScheduled = true;
  runtime.stop();
  publishRunEvent({
    requestId: `restart:${Date.now()}`,
    provider: "botpilot",
    phase: "restart-scheduled",
    message: `Restart requested from ${reason}.`,
    timestamp: new Date().toISOString(),
  });

  setTimeout(() => {
    void performSafeRestart();
  }, RESTART_DELAY_MS);
}

async function performSafeRestart(): Promise<void> {
  isQuitting = true;
  runtime.stop();
  trayController.destroy();
  try {
    await codexMcpClient?.stop();
  } catch (error) {
    console.error("Failed to stop Codex MCP client before restart", error);
  }

  app.relaunch();
  app.exit(0);
}

function buildControlRunResult(id: string, provider: string, text: string) {
  const now = new Date().toISOString();
  return {
    id,
    provider,
    ok: true,
    exitCode: 0,
    stdout: text,
    stderr: "",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    metadata: {
      control: "restart",
    },
  };
}

async function loadChatHistory(): Promise<void> {
  chatHistory.length = 0;
  const events = await chatTranscriptStore?.readRecent(CHAT_HISTORY_LIMIT);
  if (events?.length) {
    chatHistory.push(...events);
  }
}

async function publishChatMessage(event: ChatMessageEvent): Promise<void> {
  chatHistory.push(event);
  if (chatHistory.length > CHAT_HISTORY_LIMIT) {
    chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_LIMIT);
  }

  sendToMainWindow("assyst:chat-message", event);

  try {
    await chatTranscriptStore?.append(event);
  } catch (error) {
    console.error("Failed to persist chat transcript event", error);
  }
}

function publishRunEvent(event: {
  requestId: string;
  provider?: string;
  phase: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}): void {
  sendToMainWindow("assyst:run-event", event);
}

function sendToMainWindow(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function buildTelegramMessageMeta(message: IncomingMessage): string[] {
  const meta = ["telegram"];
  if (message.chatId) {
    meta.push("chat: " + message.chatId);
  }
  if (message.attachments?.length) {
    const kinds = [...new Set(message.attachments.map((attachment) => attachment.kind))];
    meta.push("attachments: " + kinds.join(", "));
    if (message.attachments.some((attachment) => getTranscriptionStatus(attachment.metadata) === "ok")) {
      meta.push("transcribed");
    }
  }
  return meta;
}

function buildTelegramMessageDisplayText(message: IncomingMessage): string {
  const text = message.text.trim();
  const hasVoice = message.attachments?.some((attachment) => attachment.kind === "voice" || attachment.kind === "audio") ?? false;
  if (!hasVoice) {
    return text;
  }

  const caption = extractCaption(text);
  if (caption) {
    return caption;
  }

  const hasTranscript = message.attachments?.some((attachment) => getTranscriptionStatus(attachment.metadata) === "ok") ?? false;
  if (hasTranscript || isGeneratedTelegramText(text)) {
    return "";
  }

  return text;
}

function buildChatMessageAttachments(message: IncomingMessage): ChatMessageAttachment[] | undefined {
  const attachments = message.attachments
    ?.map((attachment): ChatMessageAttachment => ({
      id: attachment.id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      mediaUrl: attachment.localPath ? buildAssystMediaUrl(attachment.localPath) : undefined,
      width: getNumber(attachment.metadata?.width),
      height: getNumber(attachment.metadata?.height),
      sizeBytes: getNumber(attachment.metadata?.telegramFileSize),
      durationSeconds: getNumber(attachment.metadata?.duration),
      transcript: buildChatAttachmentTranscript(attachment.metadata),
    }))
    .filter((attachment) => attachment.mediaUrl || attachment.transcript || attachment.fileName);

  return attachments?.length ? attachments : undefined;
}

function buildChatAttachmentTranscript(metadata: Record<string, unknown> | undefined): ChatAttachmentTranscript | undefined {
  const transcription = isRecord(metadata?.transcription) ? metadata.transcription : undefined;
  if (!transcription) {
    return undefined;
  }

  const status = transcription.status;
  if (status !== "ok" && status !== "unavailable" && status !== "failed") {
    return undefined;
  }

  return {
    status,
    text: getString(transcription.text),
    error: truncate(getString(transcription.error), 240),
    provider: getString(transcription.provider),
  };
}

function getTranscriptionStatus(metadata: Record<string, unknown> | undefined): string | undefined {
  const transcription = isRecord(metadata?.transcription) ? metadata.transcription : undefined;
  const status = transcription?.status;
  return typeof status === "string" ? status : undefined;
}

function registerAssystMediaProtocol(filesRoot: string): void {
  if (mediaProtocolRegistered) {
    return;
  }

  mediaProtocolRegistered = true;
  protocol.handle("assyst-media", async (request) => {
    const filePath = resolveAssystMediaPath(request.url, filesRoot);
    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function buildAssystMediaUrl(localPath: string): string | undefined {
  if (!telegramFilesRoot) {
    return undefined;
  }

  const relativePath = relativePathInsideRoot(telegramFilesRoot, localPath);
  if (!relativePath) {
    return undefined;
  }

  return `assyst-media://telegram/${Buffer.from(relativePath, "utf8").toString("base64url")}`;
}

function resolveAssystMediaPath(urlValue: string, filesRoot: string): string | undefined {
  try {
    const url = new URL(urlValue);
    if (url.hostname !== "telegram") {
      return undefined;
    }

    const encodedPath = url.pathname.replace(/^\/+/, "");
    if (!encodedPath) {
      return undefined;
    }

    const relativePath = Buffer.from(encodedPath, "base64url").toString("utf8");
    return pathInsideRoot(filesRoot, relativePath);
  } catch {
    return undefined;
  }
}

function relativePathInsideRoot(root: string, filePath: string): string | undefined {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }
  return relativePath;
}

function pathInsideRoot(root: string, relativePath: string): string | undefined {
  if (path.isAbsolute(relativePath)) {
    return undefined;
  }

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const checkedRelativePath = path.relative(resolvedRoot, resolvedPath);
  if (!checkedRelativePath || checkedRelativePath.startsWith("..") || path.isAbsolute(checkedRelativePath)) {
    return undefined;
  }
  return resolvedPath;
}

function isGeneratedTelegramText(text: string): boolean {
  return text.startsWith("Telegram message:");
}

function extractCaption(text: string): string | undefined {
  const captionLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("Caption:"));
  return captionLine?.slice("Caption:".length).trim() || undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function mirrorHostMessageToTelegram(text: string, requestId: string): Promise<void> {
  try {
    await withTrustedTelegramClient(async (client, chatId) => {
      await sendHostMessageMirror(client, { chatId, text });
    });
  } catch (error) {
    publishRunEvent({
      requestId,
      provider: masterConfig?.defaultProvider,
      phase: "telegram-mirror-failed",
      message: `Telegram mirror failed: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date().toISOString(),
    });
  }
}

async function mirrorTextToTelegram(text: string, requestId: string, failurePhase: string): Promise<void> {
  try {
    await withTrustedTelegramClient(async (client, chatId) => {
      await sendTelegramText(client, { chatId, text });
    });
  } catch (error) {
    publishRunEvent({
      requestId,
      provider: masterConfig?.defaultProvider,
      phase: failurePhase,
      message: `Telegram mirror failed: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date().toISOString(),
    });
  }
}

async function withTrustedTelegramClient(
  callback: (client: TelegramBotClient, chatId: string) => Promise<void>,
): Promise<void> {
  const settings = await getSettingsStore().getTelegramSettings();
  if (!settings.botToken || !settings.trustedChatId) {
    return;
  }

  await callback(new TelegramBotClient(settings.botToken), settings.trustedChatId);
}

function ensureMasterReady(): void {
  if (!masterAgent || !masterConfig) {
    throw new Error("Master agent is not initialized");
  }
}

function getSettingsStore(): AppSettingsStore {
  if (!settingsStore) {
    throw new Error("Settings store is not initialized");
  }
  return settingsStore;
}

function parseSendPayload(payload: unknown): { requestId?: string; text: string; provider?: string; cwd?: string } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid chat payload");
  }

  const value = payload as Record<string, unknown>;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!text) {
    throw new Error("Message text is empty");
  }

  const provider = typeof value.provider === "string" && value.provider.trim()
    ? value.provider.trim()
    : undefined;
  const cwd = typeof value.cwd === "string" && value.cwd.trim() ? value.cwd.trim() : undefined;
  const requestId = typeof value.requestId === "string" && value.requestId.trim() ? value.requestId.trim() : undefined;

  if (provider && !masterConfig?.agents[provider]) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return { requestId, text, provider, cwd };
}

function parseTelegramSettingsUpdate(payload: unknown): TelegramSettingsUpdate {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid settings payload");
  }

  const value = payload as Record<string, unknown>;
  return {
    botToken: typeof value.botToken === "string" ? value.botToken : undefined,
    trustedChatId: typeof value.trustedChatId === "string" ? value.trustedChatId : undefined,
    pollingMaxIntervalMinutes: parseOptionalNumber(value.pollingMaxIntervalMinutes),
    clearBotToken: value.clearBotToken === true,
  };
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
