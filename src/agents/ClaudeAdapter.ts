import { CommandAgentAdapter } from "./CommandAgentAdapter";
import type { ClaudeAgentConfig } from "../domain/types";

export function createClaudeAdapter(config: ClaudeAgentConfig): CommandAgentAdapter {
  return new CommandAgentAdapter("claude", (request) => {
    const args = ["--print", "--output-format", config.outputFormat ?? "text"];

    if (config.model) {
      args.push("--model", config.model);
    }

    if (config.effort) {
      args.push("--effort", config.effort);
    }

    if (config.permissionMode) {
      args.push("--permission-mode", config.permissionMode);
    }

    if (config.noSessionPersistence) {
      args.push("--no-session-persistence");
    }

    args.push(...(config.extraArgs ?? []));

    return {
      provider: "claude",
      command: config.bin ?? "claude",
      args,
      cwd: request.cwd,
      env: config.env,
      timeoutMs: config.timeoutMs,
      stdin: request.prompt,
      maxOutputBytes: config.maxOutputBytes,
    };
  });
}
