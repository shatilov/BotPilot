import { CommandAgentAdapter } from "./CommandAgentAdapter";
import type { CommandAgentConfig } from "../domain/types";

export function createGenericCommandAdapter(name: string, config: CommandAgentConfig): CommandAgentAdapter {
  return new CommandAgentAdapter(name, (request) => {
    const args = [...(config.args ?? []), ...(config.extraArgs ?? [])];
    const promptDelivery = config.promptDelivery ?? "stdin";

    if (promptDelivery === "last-arg") {
      args.push(request.prompt);
    }

    return {
      provider: name,
      command: config.command,
      args,
      cwd: request.cwd,
      env: config.env,
      timeoutMs: config.timeoutMs,
      stdin: promptDelivery === "stdin" ? request.prompt : undefined,
      maxOutputBytes: config.maxOutputBytes,
    };
  });
}
