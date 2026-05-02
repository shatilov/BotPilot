#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createAdapters } from "./agents/createAdapters";
import { loadConfig } from "./config/loadConfig";
import type { IncomingMessage } from "./domain/types";
import { MasterAgent } from "./master/MasterAgent";

interface CliOptions {
  command?: string;
  config?: string;
  provider?: string;
  text?: string;
  cwd?: string;
  chatId?: string;
  senderId?: string;
  senderName?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command !== "master") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const text = options.text ?? (await readStdin());
  if (!text.trim()) {
    throw new Error("Provide task text with --text or stdin");
  }

  const config = await loadConfig(options.config);
  const master = new MasterAgent(config, createAdapters(config));
  const message: IncomingMessage = {
    id: randomUUID(),
    transport: "cli",
    chatId: options.chatId,
    senderId: options.senderId,
    senderName: options.senderName,
    text,
    receivedAt: new Date().toISOString(),
    routing: {
      provider: options.provider,
      cwd: options.cwd,
    },
  };

  const result = await master.handleMessage(message);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!result.ok) {
    process.exitCode = result.exitCode ?? 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    command: args[0],
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--config" && next) {
      options.config = next;
      index += 1;
      continue;
    }

    if (arg === "--provider" && next) {
      options.provider = next;
      index += 1;
      continue;
    }

    if (arg === "--text" && next) {
      options.text = next;
      index += 1;
      continue;
    }

    if (arg === "--cwd" && next) {
      options.cwd = next;
      index += 1;
      continue;
    }

    if (arg === "--chat-id" && next) {
      options.chatId = next;
      index += 1;
      continue;
    }

    if (arg === "--sender-id" && next) {
      options.senderId = next;
      index += 1;
      continue;
    }

    if (arg === "--sender-name" && next) {
      options.senderName = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return options;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(data));

    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  assyst-daemon master --provider codex --text \"Do the task\" --cwd /path/to/workspace",
      "  echo \"Do the task\" | assyst-daemon master --provider claude",
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
