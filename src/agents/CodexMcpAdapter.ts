import type { AgentAdapter } from "./AgentAdapter";
import { CodexMcpClient } from "./CodexMcpClient";
import type { AgentRunRequest, AgentRunResult, CodexAgentConfig } from "../domain/types";
import type { DialogRecord, DialogStore } from "../master/DialogStore";

export interface CodexMcpAdapterOptions {
  client: CodexMcpClient;
  dialogId: string;
  dialogVersion?: string;
  store: DialogStore;
}

export class CodexMcpAdapter implements AgentAdapter {
  readonly provider = "codex";
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: CodexAgentConfig,
    private readonly options: CodexMcpAdapterOptions,
  ) {}

  run(request: AgentRunRequest): Promise<AgentRunResult> {
    request.onProgress?.({
      phase: "queued",
      message: "Turn queued for the master Codex dialog.",
      timestamp: new Date().toISOString(),
    });
    const turn = this.queue.then(() => this.runNow(request));
    this.queue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  private async runNow(request: AgentRunRequest): Promise<AgentRunResult> {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const stored = await this.options.store.get(this.options.dialogId);
    const existing = this.isCompatibleDialog(stored) ? stored : undefined;
    if (stored && !existing) {
      request.onProgress?.({
        phase: "dialog-reset",
        message: "Stored Codex thread is incompatible with the current tool configuration; creating a fresh thread.",
        timestamp: new Date().toISOString(),
      });
      await this.options.store.delete(this.options.dialogId);
    }

    try {
      request.onProgress?.({
        phase: existing ? "resuming-thread" : "creating-thread",
        message: existing
          ? `Resuming Codex MCP thread ${existing.externalThreadId}.`
          : "Creating a new Codex MCP master thread.",
        timestamp: new Date().toISOString(),
      });
      const toolResult = existing
        ? await this.reply(existing.externalThreadId, request)
        : await this.createThread(request);

      if (toolResult.isError && /Session not found/i.test(toolResult.content)) {
        request.onProgress?.({
          phase: "thread-not-found",
          message: "Codex MCP thread was not found; creating a replacement thread.",
          timestamp: new Date().toISOString(),
        });
        await this.options.store.delete(this.options.dialogId);
        const replacement = await this.createThread({
          ...request,
          prompt: [
            "The previous live Codex MCP session was not found. Start a replacement master-agent dialog.",
            "",
            request.prompt,
          ].join("\n"),
        });
        return this.toRunResult(request, startedAtDate, startedAt, replacement.content, true, replacement.threadId, true);
      }

      await this.options.store.set(this.toDialogRecord(toolResult.threadId, existing));
      request.onProgress?.({
        phase: "completed",
        message: "Codex returned a response.",
        timestamp: new Date().toISOString(),
        metadata: {
          threadId: toolResult.threadId,
        },
      });
      return this.toRunResult(request, startedAtDate, startedAt, toolResult.content, !toolResult.isError, toolResult.threadId, Boolean(existing));
    } catch (error) {
      request.onProgress?.({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      const finishedAtDate = new Date();
      return {
        id: request.id,
        provider: this.provider,
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private createThread(request: AgentRunRequest) {
    if (!this.options.client.isStarted()) {
      request.onProgress?.({
        phase: "mcp-starting",
        message: "Starting codex mcp-server.",
        timestamp: new Date().toISOString(),
      });
    }
    request.onProgress?.({
      phase: "waiting-for-codex",
      message: "Waiting for Codex to create the thread and answer.",
      timestamp: new Date().toISOString(),
    });
    return this.options.client.callCodex(this.buildCreateArgs(request), this.config.timeoutMs ?? request.timeoutMs);
  }

  private reply(threadId: string, request: AgentRunRequest) {
    if (!this.options.client.isStarted()) {
      request.onProgress?.({
        phase: "mcp-starting",
        message: "Starting codex mcp-server.",
        timestamp: new Date().toISOString(),
      });
    }
    request.onProgress?.({
      phase: "waiting-for-codex",
      message: "Waiting for Codex to continue the thread and answer.",
      timestamp: new Date().toISOString(),
      metadata: { threadId },
    });
    return this.options.client.callCodexReply({
      threadId,
      prompt: request.prompt,
    }, this.config.timeoutMs ?? request.timeoutMs);
  }

  private buildCreateArgs(request: AgentRunRequest): Record<string, unknown> {
    const args: Record<string, unknown> = {
      prompt: request.prompt,
    };

    if (request.cwd) {
      args.cwd = request.cwd;
    }

    if (this.config.model) {
      args.model = this.config.model;
    }

    if (this.config.profile) {
      args.profile = this.config.profile;
    }

    if (this.config.sandbox) {
      args.sandbox = this.config.sandbox;
    }

    if (this.config.approvalPolicy) {
      args["approval-policy"] = this.config.approvalPolicy;
    }

    if (this.config.developerInstructions) {
      args["developer-instructions"] = this.config.developerInstructions;
    }

    if (this.config.config) {
      args.config = this.config.config;
    }

    return args;
  }

  private toDialogRecord(threadId: string, existing?: DialogRecord): DialogRecord {
    const now = new Date().toISOString();
    return {
      id: this.options.dialogId,
      provider: this.provider,
      externalThreadId: threadId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      metadata: {
        kind: "codex-mcp-thread",
        dialogVersion: this.options.dialogVersion,
      },
    };
  }

  private isCompatibleDialog(record: DialogRecord | undefined): record is DialogRecord {
    if (!record) {
      return false;
    }

    if (!this.options.dialogVersion) {
      return true;
    }

    return record.metadata?.dialogVersion === this.options.dialogVersion;
  }

  private toRunResult(
    request: AgentRunRequest,
    startedAtDate: Date,
    startedAt: string,
    content: string,
    ok: boolean,
    threadId: string,
    resumed: boolean,
  ): AgentRunResult {
    const finishedAtDate = new Date();
    return {
      id: request.id,
      provider: this.provider,
      ok,
      exitCode: ok ? 0 : 1,
      stdout: content,
      stderr: "",
      startedAt,
      finishedAt: finishedAtDate.toISOString(),
      durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
      metadata: {
        dialogId: this.options.dialogId,
        codexThreadId: threadId,
        resumed,
        backend: "codex-mcp",
      },
    };
  }
}
