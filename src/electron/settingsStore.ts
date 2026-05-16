import fs from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";

export interface TelegramSettings {
  botToken?: string;
  trustedChatId?: string;
  pollingMaxIntervalMinutes: number;
}

export interface TelegramSettingsView {
  botTokenConfigured: boolean;
  trustedChatId: string;
  pollingMaxIntervalMinutes: number;
  encryptionAvailable: boolean;
}

export interface TelegramSettingsUpdate {
  botToken?: string;
  trustedChatId?: string;
  pollingMaxIntervalMinutes?: number;
  clearBotToken?: boolean;
}

export interface MasterAgentSettingsView {
  systemPrompt: string;
  mcpServersJson: string;
}

export interface MasterAgentSettingsUpdate {
  systemPrompt?: string;
  mcpServersJson?: string;
}

interface PersistedSettings {
  telegram?: PersistedTelegramSettings;
  masterAgent?: PersistedMasterAgentSettings;
}

interface PersistedTelegramSettings {
  botTokenEncrypted?: string;
  trustedChatId?: string;
  pollingMaxIntervalMinutes?: number;
}

interface PersistedMasterAgentSettings {
  systemPrompt?: string;
  mcpServersJson?: string;
}

export const DEFAULT_TELEGRAM_POLLING_MAX_INTERVAL_MINUTES = 30;
export const MAX_TELEGRAM_POLLING_INTERVAL_MINUTES = 30;
export const MIN_TELEGRAM_POLLING_INTERVAL_MINUTES = 1;

export class AppSettingsStore {
  constructor(private readonly filePath: string) {}

  async getTelegramSettings(): Promise<TelegramSettings> {
    const settings = await this.readSettings();
    const telegram = settings.telegram ?? {};
    return {
      botToken: telegram.botTokenEncrypted ? decryptToken(telegram.botTokenEncrypted) : undefined,
      trustedChatId: telegram.trustedChatId,
      pollingMaxIntervalMinutes: normalizePollingMaxIntervalMinutes(telegram.pollingMaxIntervalMinutes),
    };
  }

  async getTelegramSettingsView(): Promise<TelegramSettingsView> {
    const settings = await this.readSettings();
    return toTelegramView(settings.telegram);
  }

  async updateTelegramSettings(update: TelegramSettingsUpdate): Promise<TelegramSettingsView> {
    const settings = await this.readSettings();
    const telegram: PersistedTelegramSettings = {
      ...(settings.telegram ?? {}),
    };

    const trustedChatId = normalizeOptionalString(update.trustedChatId);
    if (trustedChatId === undefined) {
      delete telegram.trustedChatId;
    } else {
      telegram.trustedChatId = trustedChatId;
    }

    if (update.clearBotToken) {
      delete telegram.botTokenEncrypted;
    } else {
      const botToken = normalizeOptionalString(update.botToken);
      if (botToken) {
        telegram.botTokenEncrypted = encryptToken(botToken);
      }
    }

    telegram.pollingMaxIntervalMinutes = normalizePollingMaxIntervalMinutes(update.pollingMaxIntervalMinutes);

    settings.telegram = telegram;
    await this.writeSettings(settings);
    return toTelegramView(telegram);
  }

  async getMasterAgentSettings(defaults: MasterAgentSettingsView): Promise<MasterAgentSettingsView> {
    const settings = await this.readSettings();
    return toMasterAgentView(settings.masterAgent, defaults);
  }

  async updateMasterAgentSettings(
    update: MasterAgentSettingsUpdate,
    defaults: MasterAgentSettingsView,
  ): Promise<MasterAgentSettingsView> {
    const settings = await this.readSettings();
    const masterAgent: PersistedMasterAgentSettings = {
      ...(settings.masterAgent ?? {}),
    };

    const systemPrompt = update.systemPrompt === undefined
      ? defaults.systemPrompt
      : normalizeOptionalString(update.systemPrompt);
    if (systemPrompt === undefined || systemPrompt === defaults.systemPrompt) {
      delete masterAgent.systemPrompt;
    } else {
      masterAgent.systemPrompt = systemPrompt;
    }

    const mcpServersJson = update.mcpServersJson === undefined
      ? defaults.mcpServersJson
      : normalizeMcpServersJson(update.mcpServersJson);
    if (mcpServersJson === defaults.mcpServersJson) {
      delete masterAgent.mcpServersJson;
    } else {
      masterAgent.mcpServersJson = mcpServersJson;
    }

    settings.masterAgent = masterAgent;
    await this.writeSettings(settings);
    return toMasterAgentView(masterAgent, defaults);
  }

  private async readSettings(): Promise<PersistedSettings> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return isObject(parsed) ? (parsed as PersistedSettings) : {};
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  private async writeSettings(settings: PersistedSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}

function toTelegramView(telegram: PersistedTelegramSettings | undefined): TelegramSettingsView {
  return {
    botTokenConfigured: Boolean(telegram?.botTokenEncrypted),
    trustedChatId: telegram?.trustedChatId ?? "",
    pollingMaxIntervalMinutes: normalizePollingMaxIntervalMinutes(telegram?.pollingMaxIntervalMinutes),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function toMasterAgentView(
  masterAgent: PersistedMasterAgentSettings | undefined,
  defaults: MasterAgentSettingsView,
): MasterAgentSettingsView {
  return {
    systemPrompt: normalizeOptionalString(masterAgent?.systemPrompt) ?? defaults.systemPrompt,
    mcpServersJson: normalizeMcpServersJson(masterAgent?.mcpServersJson ?? defaults.mcpServersJson),
  };
}

function encryptToken(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure token storage is not available on this system");
  }
  return safeStorage.encryptString(value).toString("base64");
}

function decryptToken(value: string): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) {
    return undefined;
  }

  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return undefined;
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeMcpServersJson(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("MCP servers must be a JSON object");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("MCP servers must be a JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`MCP servers JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isObject(parsed) || Array.isArray(parsed)) {
    throw new Error("MCP servers must be a JSON object");
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function normalizePollingMaxIntervalMinutes(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_TELEGRAM_POLLING_MAX_INTERVAL_MINUTES;
  }

  return Math.min(
    MAX_TELEGRAM_POLLING_INTERVAL_MINUTES,
    Math.max(MIN_TELEGRAM_POLLING_INTERVAL_MINUTES, Math.round(numeric)),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
