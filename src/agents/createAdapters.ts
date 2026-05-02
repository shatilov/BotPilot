import type { AgentAdapter } from "./AgentAdapter";
import { createClaudeAdapter } from "./ClaudeAdapter";
import { createCodexAdapter } from "./CodexAdapter";
import { createGenericCommandAdapter } from "./GenericCommandAdapter";
import type { MasterAgentConfig } from "../domain/types";

export function createAdapters(config: MasterAgentConfig): Map<string, AgentAdapter> {
  const adapters = new Map<string, AgentAdapter>();

  for (const [name, agentConfig] of Object.entries(config.agents)) {
    if (agentConfig.type === "codex") {
      adapters.set(name, createCodexAdapter(agentConfig));
      continue;
    }

    if (agentConfig.type === "claude") {
      adapters.set(name, createClaudeAdapter(agentConfig));
      continue;
    }

    if (agentConfig.type === "command") {
      adapters.set(name, createGenericCommandAdapter(name, agentConfig));
      continue;
    }

    const unsupported = agentConfig as { type?: string };
    throw new Error(`Unsupported agent adapter type: ${unsupported.type ?? "unknown"}`);
  }

  return adapters;
}
