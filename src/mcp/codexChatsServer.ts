#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getCodexChat, listCodexChats, listCodexProjects } from "../codex/codexData";

const server = new McpServer({
  name: "botpilot-codex-chats",
  version: "0.1.0",
});

server.registerTool(
  "list_codex_chats",
  {
    description: "List local Codex chats from the Codex session index. Returns id, name, and updatedAt.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().describe("Maximum chats to return. Default: 50."),
    },
  },
  async ({ limit }) => textJson(await listCodexChats({ limit })),
);

server.registerTool(
  "get_codex_chat",
  {
    description: "Read a local Codex chat transcript by id. Returns recent user/assistant messages only.",
    inputSchema: {
      id: z.string().describe("Codex chat/session id."),
      max_messages: z.number().int().min(1).max(200).optional().describe("Maximum recent messages. Default: 40."),
    },
  },
  async ({ id, max_messages }) => textJson(await getCodexChat({ id, maxMessages: max_messages })),
);

server.registerTool(
  "list_codex_projects",
  {
    description: "List trusted/local Codex projects from the Codex config.",
    inputSchema: {},
  },
  async () => textJson(await listCodexProjects()),
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

function textJson(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
