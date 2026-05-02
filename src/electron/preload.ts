import { contextBridge, ipcRenderer } from "electron";
import type { AgentRunResult } from "../domain/types";

export interface ChatSettings {
  defaultProvider: string;
  providers: string[];
  workspaceRoot?: string;
}

export interface ChatSendRequest {
  requestId?: string;
  text: string;
  provider?: string;
  cwd?: string;
}

export interface ChatRunEvent {
  requestId: string;
  provider?: string;
  phase: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
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

export interface AssystApi {
  getSettings(): Promise<ChatSettings>;
  sendMessage(request: ChatSendRequest): Promise<AgentRunResult>;
  onRunEvent(callback: (event: ChatRunEvent) => void): () => void;
  openSettings(): Promise<void>;
  getTelegramSettings(): Promise<TelegramSettingsView>;
  saveTelegramSettings(update: TelegramSettingsUpdate): Promise<TelegramSettingsView>;
}

const api: AssystApi = {
  getSettings: () => ipcRenderer.invoke("assyst:get-settings") as Promise<ChatSettings>,
  sendMessage: (request) => ipcRenderer.invoke("assyst:send-message", request) as Promise<AgentRunResult>,
  onRunEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, runEvent: ChatRunEvent) => callback(runEvent);
    ipcRenderer.on("assyst:run-event", listener);
    return () => ipcRenderer.off("assyst:run-event", listener);
  },
  openSettings: () => ipcRenderer.invoke("assyst:open-settings") as Promise<void>,
  getTelegramSettings: () => ipcRenderer.invoke("assyst:get-telegram-settings") as Promise<TelegramSettingsView>,
  saveTelegramSettings: (update) => ipcRenderer.invoke("assyst:save-telegram-settings", update) as Promise<TelegramSettingsView>,
};

contextBridge.exposeInMainWorld("assyst", api);
