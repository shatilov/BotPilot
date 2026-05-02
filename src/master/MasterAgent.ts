import type { AgentAdapter } from "../agents/AgentAdapter";
import type { AgentProgressReporter, AgentRunResult, IncomingMessage, MasterAgentConfig } from "../domain/types";
import { buildMasterPrompt } from "./promptBuilder";

export class MasterAgent {
  constructor(
    private readonly config: MasterAgentConfig,
    private readonly adapters: Map<string, AgentAdapter>,
  ) {}

  async handleMessage(message: IncomingMessage, onProgress?: AgentProgressReporter): Promise<AgentRunResult> {
    const provider = message.routing?.provider ?? this.config.defaultProvider;
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new Error(`No adapter configured for provider: ${provider}`);
    }

    const text = message.text.trim();
    if (!text) {
      throw new Error("Incoming message text is empty");
    }

    return adapter.run({
      id: message.id,
      provider,
      prompt: buildMasterPrompt({ ...message, text }),
      cwd: message.routing?.cwd ?? this.config.workspaceRoot,
      timeoutMs: this.config.timeoutMs,
      onProgress,
      metadata: {
        transport: message.transport,
        chatId: message.chatId,
        senderId: message.senderId,
      },
    });
  }
}
