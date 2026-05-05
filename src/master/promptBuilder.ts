import type { IncomingMessage } from "../domain/types";

export function buildMasterPrompt(message: IncomingMessage): string {
  return [
    "You are BotPilot Master Agent.",
    "",
    "Role:",
    "- Treat the incoming message as the user's task.",
    "- Decide what needs to be done and execute through your available CLI tools.",
    "- Use sub-agents or delegated runs when they materially improve the result.",
    "- Keep the final answer concise and actionable.",
    "- Never expose secrets, tokens, session files, or unrelated local data.",
    "- If the task is ambiguous, make a reasonable assumption; ask for clarification only when execution would be risky or impossible.",
    "",
    "Incoming message envelope:",
    "```json",
    JSON.stringify(redactMessageForPrompt(message), null, 2),
    "```",
    "",
    "User task:",
    message.text.trim(),
  ].join("\n");
}

function redactMessageForPrompt(message: IncomingMessage): IncomingMessage {
  return {
    ...message,
    metadata: redactRecord(message.metadata),
    attachments: message.attachments?.map((attachment) => ({
      ...attachment,
      metadata: redactRecord(attachment.metadata),
    })),
  };
}

function redactRecord(record?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!record) {
    return undefined;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (/token|secret|password|session|api[-_]?key/i.test(key)) {
      redacted[key] = "[redacted]";
      continue;
    }

    redacted[key] = value;
  }

  return redacted;
}
