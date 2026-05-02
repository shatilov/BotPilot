import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface CodexMcpClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface CodexMcpToolResult {
  threadId: string;
  content: string;
  isError: boolean;
  raw: unknown;
}

interface PendingRequest {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const INIT_TIMEOUT_MS = 15_000;

export class CodexMcpClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private startPromise: Promise<void> | undefined;
  private stderrTail = "";

  constructor(private readonly options: CodexMcpClientOptions) {}

  isStarted(): boolean {
    return Boolean(this.child);
  }

  async callCodex(args: Record<string, unknown>, timeoutMs?: number): Promise<CodexMcpToolResult> {
    return this.callTool("codex", args, timeoutMs);
  }

  async callCodexReply(args: Record<string, unknown>, timeoutMs?: number): Promise<CodexMcpToolResult> {
    return this.callTool("codex-reply", args, timeoutMs);
  }

  async stop(): Promise<void> {
    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = undefined;
    this.startPromise = undefined;
    child.kill("SIGTERM");
  }

  private async callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<CodexMcpToolResult> {
    await this.start();
    const response = await this.request("tools/call", { name, arguments: args }, timeoutMs);
    const result = ensureRecord(response.result, `Invalid ${name} tool result`);
    const structured = ensureRecord(result.structuredContent, `Missing ${name} structuredContent`);
    const threadId = typeof structured.threadId === "string" ? structured.threadId : "";
    const content = typeof structured.content === "string" ? structured.content : "";

    if (!threadId) {
      throw new Error(`Codex MCP ${name} returned no threadId`);
    }

    return {
      threadId,
      content,
      isError: result.isError === true,
      raw: result,
    };
  }

  private async start(): Promise<void> {
    if (this.child) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startNow();
    return this.startPromise;
  }

  private async startNow(): Promise<void> {
    this.child = spawn(this.options.command, this.options.args ?? ["mcp-server"], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => this.handleStderr(chunk));
    this.child.on("exit", (code, signal) => this.handleExit(code, signal));
    this.child.on("error", (error) => this.rejectAll(error));

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "assyst-daemon",
        version: "0.1.0",
      },
    }, INIT_TIMEOUT_MS);
    this.notify("notifications/initialized", {});
  }

  private request(method: string, params: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<JsonRpcResponse> {
    if (!this.child) {
      return Promise.reject(new Error("Codex MCP server is not started"));
    }

    const id = this.nextId;
    this.nextId += 1;

    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex MCP request timed out: ${method}`));
      }, timeoutMs);
      timer.unref();

      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");

    for (;;) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      this.handleJsonLine(line);
    }
  }

  private handleJsonLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (!isRecord(message) || typeof message.id !== "number") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    const response = message as unknown as JsonRpcResponse;
    if (response.error) {
      pending.reject(new Error(response.error.message));
      return;
    }

    pending.resolve(response);
  }

  private handleStderr(chunk: Buffer): void {
    this.stderrTail = appendTail(this.stderrTail, chunk.toString("utf8"), 16_384);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = undefined;
    this.startPromise = undefined;
    this.rejectAll(new Error(`Codex MCP server exited: code=${String(code)} signal=${String(signal)}${this.stderrTail ? `\n${this.stderrTail}` : ""}`));
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function ensureRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function appendTail(current: string, next: string, maxLength: number): string {
  const value = current + next;
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
}
