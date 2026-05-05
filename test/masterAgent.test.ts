import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../src/agents/AgentAdapter";
import type { AgentRunRequest, AgentRunResult, IncomingMessage, MasterAgentConfig } from "../src/domain/types";
import { MasterAgent } from "../src/master/MasterAgent";
import { buildMasterPrompt } from "../src/master/promptBuilder";

class FakeAdapter implements AgentAdapter {
  readonly provider = "fake";
  request?: AgentRunRequest;

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.request = request;
    return {
      id: request.id,
      provider: request.provider,
      ok: true,
      exitCode: 0,
      stdout: "done",
      stderr: "",
      startedAt: "2026-05-02T00:00:00.000Z",
      finishedAt: "2026-05-02T00:00:01.000Z",
      durationMs: 1000,
    };
  }
}

const message: IncomingMessage = {
  id: "message-1",
  transport: "telegram",
  chatId: "chat-1",
  senderId: "user-1",
  senderName: "User",
  text: "Run the task",
  receivedAt: "2026-05-02T00:00:00.000Z",
  metadata: {
    token: "secret-token",
    safe: "value",
  },
};

describe("MasterAgent", () => {
  it("routes an incoming message to the selected adapter", async () => {
    const adapter = new FakeAdapter();
    const config: MasterAgentConfig = {
      defaultProvider: "fake",
      workspaceRoot: "/tmp/workspace",
      agents: {},
    };

    const master = new MasterAgent(config, new Map([["fake", adapter]]));
    const result = await master.handleMessage(message);

    expect(result.ok).toBe(true);
    expect(adapter.request?.cwd).toBe("/tmp/workspace");
    expect(adapter.request?.prompt).toContain("Run the task");
  });

  it("redacts sensitive metadata in the prompt", () => {
    const prompt = buildMasterPrompt(message);

    expect(prompt).toContain("[redacted]");
    expect(prompt).not.toContain("secret-token");
    expect(prompt).toContain("BotPilot Master Agent");
  });
});
