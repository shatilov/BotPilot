import { spawn } from "node:child_process";
import type { AgentAdapter } from "./AgentAdapter";
import type { AgentProvider, AgentRunRequest, AgentRunResult } from "../domain/types";

export interface CommandRunnerOptions {
  requestId: string;
  provider: AgentProvider;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  stdin?: string;
  maxOutputBytes?: number;
}

export type CommandRunnerPlan = Omit<CommandRunnerOptions, "requestId">;

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export class CommandAgentAdapter implements AgentAdapter {
  readonly provider: AgentProvider;

  constructor(
    provider: AgentProvider,
    private readonly createCommand: (request: AgentRunRequest) => CommandRunnerPlan,
  ) {
    this.provider = provider;
  }

  run(request: AgentRunRequest): Promise<AgentRunResult> {
    const options = this.createCommand(request);
    return runCommand({
      ...options,
      requestId: request.id,
      provider: this.provider,
      timeoutMs: options.timeoutMs ?? request.timeoutMs,
    });
  }
}

export function runCommand(options: CommandRunnerOptions): Promise<AgentRunResult> {
  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (exitCode: number | null, error?: string) => {
      if (settled) {
        return;
      }

      settled = true;
      const finishedAtDate = new Date();
      resolve({
        id: options.requestId,
        provider: options.provider,
        ok: exitCode === 0 && !error,
        exitCode,
        stdout,
        stderr,
        startedAt,
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        error,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 3000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"), maxOutputBytes);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"), maxOutputBytes);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish(null, error.message);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        finish(exitCode, `Command timed out after ${timeoutMs}ms`);
        return;
      }

      finish(exitCode);
    });

    if (options.stdin) {
      child.stdin.end(options.stdin);
      return;
    }

    child.stdin.end();
  });
}

function appendBounded(current: string, next: string, maxBytes: number): string {
  const value = current + next;
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }

  const marker = "\n[assyst-daemon: output truncated]\n";
  const allowed = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  return marker + Buffer.from(value, "utf8").subarray(-allowed).toString("utf8");
}
