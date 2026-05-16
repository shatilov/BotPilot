import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, shell, systemPreferences } from "electron";
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
import { resolveCommand, withCommandSearchPath } from "./commandResolver";
import { renderSettingsPage } from "./settingsPage";
import {
  AppSettingsStore,
  DEFAULT_TELEGRAM_POLLING_MAX_INTERVAL_MINUTES,
  type MasterAgentSettingsUpdate,
  type MasterAgentSettingsView,
  type TelegramSettingsUpdate,
} from "./settingsStore";
import { BotPilotBrowserUseBackend } from "./browserUseBackend";
import { TrayController } from "./trayController";
import { CommandVoiceTranscriber, enrichVoiceTranscripts } from "./voiceTranscription";

let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let isQuitting = false;
let masterAgent: MasterAgent | undefined;
let masterConfig: MasterAgentConfig | undefined;
let codexMcpClient: CodexMcpClient | undefined;
let browserUseBackend: BotPilotBrowserUseBackend | undefined;
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
    void browserUseBackend?.stop();
    trayController.destroy();
    app.quit();
  },
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.exit(0);
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
    width: 760,
    height: 660,
    title: "BotPilot Settings",
    show: true,
    resizable: true,
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
    settingsStore = new AppSettingsStore(path.join(app.getPath("userData"), "settings.json"));
    chatTranscriptStore = new JsonlChatTranscriptStore(path.join(app.getPath("userData"), "chat-transcript.jsonl"));
    telegramFilesRoot = path.join(app.getPath("userData"), "telegram-files");
    registerAssystMediaProtocol(telegramFilesRoot);
    browserUseBackend = new BotPilotBrowserUseBackend();
    await browserUseBackend.start();
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
    await setupMasterAgent();
    setupIpcHandlers();
    trayController.create();
    setInterval(() => trayController.updateMenu(), 15_000).unref();
    await createWindow();
    void requestMacOsControlPermissions();
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
  void browserUseBackend?.stop();
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

async function setupMasterAgent(): Promise<void> {
  const previousCodexMcpClient = codexMcpClient;
  codexMcpClient = undefined;
  masterAgent = undefined;
  masterConfig = undefined;
  await previousCodexMcpClient?.stop();

  const workspaceRoot = resolveWorkspaceRoot();
  const dialogStore = new JsonDialogStore(path.join(app.getPath("userData"), "dialogs.json"));
  const codexChatsMcpPath = resolveCodexChatsMcpPath();
  const defaultMasterAgentSettings = buildDefaultMasterAgentSettings(codexChatsMcpPath);
  const masterAgentSettings = await getSettingsStore().getMasterAgentSettings(defaultMasterAgentSettings);
  const mcpServers = parseMcpServersJson(masterAgentSettings.mcpServersJson);
  const baseCodexConfig = defaultConfig.agents.codex;
  const baseClaudeConfig = defaultConfig.agents.claude;
  if (baseCodexConfig.type !== "codex" || baseClaudeConfig.type !== "claude") {
    throw new Error("Default agent config is invalid");
  }

  const codexConfig: CodexAgentConfig = {
    ...baseCodexConfig,
    bin: resolveCommand(baseCodexConfig.bin ?? "codex"),
    env: withCommandSearchPath(baseCodexConfig.env),
    sandbox: "danger-full-access",
    developerInstructions: masterAgentSettings.systemPrompt,
    config: {
      mcp_servers: mcpServers,
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
        env: withCommandSearchPath(baseClaudeConfig.env),
      },
      echo: {
        type: "command",
        command: resolveCommand("node"),
        args: ["-e", "process.stdin.pipe(process.stdout)"],
        env: withCommandSearchPath(),
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
    dialogVersion: buildMasterDialogVersion(masterAgentSettings),
    buildSeedPrompt: (request) => buildRecentTranscriptSeedPrompt(request.id),
    store: dialogStore,
  }));

  masterAgent = new MasterAgent(config, adapters);
}

function buildDefaultMasterAgentSettings(codexChatsMcpPath: string): MasterAgentSettingsView {
  return {
    systemPrompt: buildDefaultMasterSystemPrompt(),
    mcpServersJson: formatJson(buildDefaultMcpServers(codexChatsMcpPath)),
  };
}

function buildDefaultMasterSystemPrompt(): string {
  return [
    "You have BotPilot MCP tools for local Codex data.",
    "Use list_codex_chats when the user asks for Codex chats, sessions, threads, or conversation history.",
    "Use get_codex_chat only for a specific chat id or when the user clearly asks to inspect a selected chat.",
    "Use list_codex_projects when the user asks for Codex projects or trusted workspaces.",
    "You have a node_repl MCP server. For browser-use tasks, first run tool_search for node_repl js and use the mcp__node_repl__js tool.",
    "For real browser tasks, prefer the dedicated BotPilot Chrome controlled through CDP at http://127.0.0.1:9222 with profile /Users/shatilov/Library/Application Support/BotPilot/ChromeProfile.",
    "If that Chrome is not already running, start /Applications/Google Chrome.app/Contents/MacOS/Google Chrome with --remote-debugging-port=9222 and --user-data-dir=/Users/shatilov/Library/Application Support/BotPilot/ChromeProfile.",
    "Use the in-app Browser Use backend named iab only as a fallback; navigation through iab is currently known to hang in some cases.",
    "For authenticated websites, rely on the dedicated BotPilot Chrome profile and ask the user to log in there once if needed.",
    "Subagents that need browser access must also use node_repl js; do not report browser-use unavailable before checking tool_search.",
    "Do not expose secrets from transcripts; summarize sensitive content instead of quoting it.",
  ].join("\n");
}

function buildDefaultMcpServers(codexChatsMcpPath: string): Record<string, unknown> {
  return {
    node_repl: {
      command: resolveNodeReplCommand(),
      env: buildNodeReplEnv(),
    },
    botpilot_codex_chats: {
      command: resolveCommand("node"),
      args: [codexChatsMcpPath],
    },
  };
}

function parseMcpServersJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP servers must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildMasterDialogVersion(settings: MasterAgentSettingsView): string {
  const hash = createHash("sha256")
    .update(settings.systemPrompt)
    .update("\n---mcp---\n")
    .update(settings.mcpServersJson)
    .digest("hex")
    .slice(0, 16);
  return `codex-mcp+master-settings-${hash}`;
}

function getDefaultMasterAgentSettings(): MasterAgentSettingsView {
  return buildDefaultMasterAgentSettings(resolveCodexChatsMcpPath());
}

function resolveWorkspaceRoot(): string {
  const configured = process.env.BOTPILOT_WORKSPACE_ROOT ?? process.env.ASSYST_WORKSPACE_ROOT;
  if (configured?.trim()) {
    return configured.trim();
  }

  return app.isPackaged ? os.homedir() : app.getAppPath();
}

function resolveCodexChatsMcpPath(): string {
  const bundledPath = path.join(__dirname, "..", "mcp", "codexChatsServer.js");
  if (!app.isPackaged) {
    return bundledPath;
  }

  return bundledPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

function resolveNodeReplCommand(): string {
  const configured = process.env.BOTPILOT_NODE_REPL_BIN ?? process.env.CODEX_NODE_REPL_BIN;
  if (configured?.trim()) {
    return configured.trim();
  }

  const appBundlePath = "/Applications/Codex.app/Contents/Resources/node_repl";
  if (existsSync(appBundlePath)) {
    return appBundlePath;
  }

  return resolveCommand("node_repl");
}

function buildNodeReplEnv(): Record<string, string> {
  const trustedCodePaths = [
    path.join(os.homedir(), ".codex", "plugins", "cache", "openai-bundled", "browser-use"),
    "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/browser-use",
  ];

  return {
    BROWSER_USE_DISABLE_AMBIENT_NETWORK: "1",
    NODE_REPL_REQUEST_META: JSON.stringify({
      "x-codex-browser-use-disable-ambient-network": true,
      "x-codex-browser-use-security-mode": "disabled-for-local-testing",
    }),
    NODE_REPL_BROWSER_CLIENT_MARKETPLACE_NAME: "openai-bundled",
    NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S: "9990b9b3defcd92659e0d88c4cf847d97c64c0af047c4a24266821711c24749e",
    NODE_REPL_TRUSTED_CODE_PATHS: trustedCodePaths.filter(existsSync).join(path.delimiter),
  };
}

async function requestMacOsControlPermissions(): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  const panesToOpen = new Set<string>();
  const accessibilityTrusted = systemPreferences.isTrustedAccessibilityClient(true);
  if (!accessibilityTrusted) {
    panesToOpen.add("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
  }

  if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
    try {
      await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: 1,
          height: 1,
        },
      });
    } catch (error) {
      console.error("Failed to request screen recording permission", error);
    }

    if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
      panesToOpen.add("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    }
  }

  panesToOpen.add("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent");

  for (const paneUrl of panesToOpen) {
    await shell.openExternal(paneUrl);
    await delay(500);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildRecentTranscriptSeedPrompt(currentRequestId: string): Promise<string | undefined> {
  const events = await readRecentTranscriptForSeed(currentRequestId, 20);
  if (!events.length) {
    return undefined;
  }

  return [
    "Recent BotPilot chat transcript before this new master-agent session.",
    "Use it to resolve follow-ups like \"try again\", \"continue\", or \"fix that\". The current user task appears after this transcript and has priority.",
    "",
    formatTranscriptEvents(events),
  ].join("\n");
}

async function readRecentTranscriptForSeed(currentRequestId: string, limit: number): Promise<ChatMessageEvent[]> {
  const fromMemory = chatHistory.filter((event) => event.requestId !== currentRequestId).slice(-limit);
  if (fromMemory.length) {
    return fromMemory;
  }

  const fromStore = await chatTranscriptStore?.readRecent(limit + 8);
  return (fromStore ?? []).filter((event) => event.requestId !== currentRequestId).slice(-limit);
}

function formatTranscriptEvents(events: ChatMessageEvent[]): string {
  return events
    .map((event) => {
      const meta = event.meta?.length ? ` (${event.meta.join(", ")})` : "";
      const attachments = formatTranscriptAttachments(event.attachments);
      const text = truncateForSeed(event.text.trim() || "[no text]", 1_500);
      return `- ${event.timestamp} ${event.role}/${event.kind}${meta}: ${text}${attachments}`;
    })
    .join("\n");
}

function formatTranscriptAttachments(attachments: ChatMessageAttachment[] | undefined): string {
  if (!attachments?.length) {
    return "";
  }

  const parts = attachments.map((attachment) => {
    const name = attachment.fileName ? ` ${attachment.fileName}` : "";
    const transcript = attachment.transcript?.text ? ` transcript=${truncateForSeed(attachment.transcript.text, 500)}` : "";
    return `${attachment.kind}${name}${transcript}`;
  });
  return ` [attachments: ${parts.join("; ")}]`;
}

function truncateForSeed(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
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

  ipcMain.handle("assyst:get-master-agent-settings", async () => {
    return getSettingsStore().getMasterAgentSettings(getDefaultMasterAgentSettings());
  });

  ipcMain.handle("assyst:save-master-agent-settings", async (_event, payload: unknown) => {
    const settings = await getSettingsStore().updateMasterAgentSettings(
      parseMasterAgentSettingsUpdate(payload),
      getDefaultMasterAgentSettings(),
    );
    await setupMasterAgent();
    return settings;
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
  try {
    await browserUseBackend?.stop();
  } catch (error) {
    console.error("Failed to stop Browser Use backend before restart", error);
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

function parseMasterAgentSettingsUpdate(payload: unknown): MasterAgentSettingsUpdate {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid settings payload");
  }

  const value = payload as Record<string, unknown>;
  return {
    systemPrompt: typeof value.systemPrompt === "string" ? value.systemPrompt : undefined,
    mcpServersJson: typeof value.mcpServersJson === "string" ? value.mcpServersJson : undefined,
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
