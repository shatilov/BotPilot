import type { AgentProvider, AgentRunRequest, AgentRunResult } from "../domain/types";

export interface AgentAdapter {
  readonly provider: AgentProvider;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
