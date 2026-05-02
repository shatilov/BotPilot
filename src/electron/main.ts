import { randomUUID } from "node:crypto";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { CodexMcpAdapter } from "../agents/CodexMcpAdapter";
import { CodexMcpClient } from "../agents/CodexMcpClient";
import { createAdapters } from "../agents/createAdapters";
import { defaultConfig } from "../config/defaultConfig";
import type { CodexAgentConfig, IncomingMessage, MasterAgentConfig } from "../domain/types";
import { JsonDialogStore } from "../master/DialogStore";
import { MasterAgent } from "../master/MasterAgent";
import { TelegramPollingService } from "../telegram/TelegramPollingService";
import { JsonTelegramStateStore } from "../telegram/TelegramStateStore";
import { BackgroundRuntime } from "./backgroundRuntime";
import { renderChatPage } from "./chatPage";
import { resolveCommand } from "./commandResolver";
import { renderSettingsPage } from "./settingsPage";
import { AppSettingsStore, DEFAULT_TELEGRAM_POLLING_MAX_INTERVAL_MINUTES, type TelegramSettingsUpdate } from "./settingsStore";
import { TrayController } from "./trayController";

let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let isQuitting = false;
let masterAgent: MasterAgent | undefined;
let masterConfig: MasterAgentConfig | undefined;
let codexMcpClient: CodexMcpClient | undefined;
let settingsStore: AppSettingsStore | undefined;
let telegramPollingService: TelegramPollingService | undefined;

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

async function createWindow(): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    title: "Assyst Daemon",
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
    title: "Assyst Settings",
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

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  settingsStore = new AppSettingsStore(path.join(app.getPath("userData"), "settings.json"));
  telegramPollingService = new TelegramPollingService({
    settingsStore,
    stateStore: new JsonTelegramStateStore(path.join(app.getPath("userData"), "telegram-state.json")),
    filesRoot: path.join(app.getPath("userData"), "telegram-files"),
    getMasterAgent: () => masterAgent,
    getMasterConfig: () => masterConfig,
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
  const raw = process.env.ASSYST_BACKGROUND_INTERVAL_MS;
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
      "You have Assyst MCP tools for local Codex data.",
      "Use list_codex_chats when the user asks for Codex chats, sessions, threads, or conversation history.",
      "Use get_codex_chat only for a specific chat id or when the user clearly asks to inspect a selected chat.",
      "Use list_codex_projects when the user asks for Codex projects or trusted workspaces.",
      "Do not expose secrets from transcripts; summarize sensitive content instead of quoting it.",
    ].join("\n"),
    config: {
      mcp_servers: {
        assyst_codex_chats: {
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
    dialogVersion: "codex-mcp+assyst-codex-chats-v2",
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

    const provider = request.provider ?? masterConfig?.defaultProvider;
    _event.sender.send("assyst:run-event", {
      requestId,
      provider,
      phase: "received",
      message: "Request received by Assyst.",
      timestamp: new Date().toISOString(),
    });

    return masterAgent?.handleMessage(message, (progress) => {
      _event.sender.send("assyst:run-event", {
        requestId,
        provider,
        phase: progress.phase,
        message: progress.message,
        timestamp: progress.timestamp ?? new Date().toISOString(),
        metadata: progress.metadata,
      });
    });
  });
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
