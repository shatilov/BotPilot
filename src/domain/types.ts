export type AgentProvider = "codex" | "claude" | "command" | string;

export interface IncomingMessage {
  id: string;
  transport: "telegram" | "cli" | string;
  chatId?: string;
  senderId?: string;
  senderName?: string;
  text: string;
  receivedAt: string;
  attachments?: IncomingAttachment[];
  metadata?: Record<string, unknown>;
  routing?: {
    provider?: AgentProvider;
    cwd?: string;
  };
}

export interface IncomingAttachment {
  id: string;
  kind: "photo" | "document" | "audio" | "voice" | "video" | "animation" | "sticker" | "video_note" | "unknown";
  fileName?: string;
  mimeType?: string;
  localPath?: string;
  remoteId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunRequest {
  id: string;
  provider: AgentProvider;
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  onProgress?: AgentProgressReporter;
}

export type AgentProgressReporter = (event: AgentProgressEvent) => void;

export interface AgentProgressEvent {
  phase: string;
  message: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunResult {
  id: string;
  provider: AgentProvider;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface MasterAgentConfig {
  defaultProvider: AgentProvider;
  workspaceRoot?: string;
  timeoutMs?: number;
  agents: Record<string, AgentConfig>;
}

export type AgentConfig = CodexAgentConfig | ClaudeAgentConfig | CommandAgentConfig;

export interface BaseAgentConfig {
  type: AgentProvider;
  bin?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  extraArgs?: string[];
  maxOutputBytes?: number;
}

export interface CodexAgentConfig extends BaseAgentConfig {
  type: "codex";
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-request" | "never";
  profile?: string;
  developerInstructions?: string;
  jsonEvents?: boolean;
  bypassApprovalsAndSandbox?: boolean;
  config?: Record<string, unknown>;
}

export interface ClaudeAgentConfig extends BaseAgentConfig {
  type: "claude";
  model?: string;
  effort?: "low" | "medium" | "high" | "max";
  permissionMode?: "acceptEdits" | "bypassPermissions" | "default" | "dontAsk" | "plan" | "auto";
  outputFormat?: "text" | "json" | "stream-json";
  noSessionPersistence?: boolean;
}

export interface CommandAgentConfig extends BaseAgentConfig {
  type: "command";
  command: string;
  args?: string[];
  promptDelivery?: "stdin" | "last-arg";
}
