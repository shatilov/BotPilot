import { CommandAgentAdapter } from "./CommandAgentAdapter";
import type { CodexAgentConfig } from "../domain/types";

export function createCodexAdapter(config: CodexAgentConfig): CommandAgentAdapter {
  return new CommandAgentAdapter("codex", (request) => {
    const args = ["exec", "--color", "never"];

    if (request.cwd) {
      args.push("-C", request.cwd);
    }

    if (config.model) {
      args.push("-m", config.model);
    }

    if (config.profile) {
      args.push("-p", config.profile);
    }

    if (config.sandbox) {
      args.push("-s", config.sandbox);
    }

    if (config.approvalPolicy) {
      args.push("-a", config.approvalPolicy);
    }

    if (config.jsonEvents) {
      args.push("--json");
    }

    if (config.bypassApprovalsAndSandbox) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }

    args.push(...(config.extraArgs ?? []));
    args.push("-");

    return {
      provider: "codex",
      command: config.bin ?? "codex",
      args,
      cwd: request.cwd,
      env: config.env,
      timeoutMs: config.timeoutMs,
      stdin: request.prompt,
      maxOutputBytes: config.maxOutputBytes,
    };
  });
}
