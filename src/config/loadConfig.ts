import { readFile } from "node:fs/promises";
import { defaultConfig } from "./defaultConfig";
import type { MasterAgentConfig } from "../domain/types";

export async function loadConfig(configPath?: string): Promise<MasterAgentConfig> {
  if (!configPath) {
    return defaultConfig;
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<MasterAgentConfig>;

  return {
    ...defaultConfig,
    ...parsed,
    agents: {
      ...defaultConfig.agents,
      ...(parsed.agents ?? {}),
    },
  };
}
