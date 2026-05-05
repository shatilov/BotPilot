import { spawn } from "node:child_process";
import type { IncomingAttachment, IncomingMessage } from "../domain/types";

export type VoiceTranscriptStatus = "ok" | "unavailable" | "failed";

export interface VoiceTranscriptResult {
  status: VoiceTranscriptStatus;
  text?: string;
  error?: string;
  provider?: string;
  durationMs?: number;
}

export interface VoiceTranscriber {
  transcribe(filePath: string, attachment: IncomingAttachment): Promise<VoiceTranscriptResult>;
}

export interface CommandVoiceTranscriberOptions {
  commandTemplate?: string;
  language?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_TRANSCRIPTION_OUTPUT_BYTES = 2 * 1024 * 1024;

export class CommandVoiceTranscriber implements VoiceTranscriber {
  constructor(private readonly options: CommandVoiceTranscriberOptions = {}) {}

  async transcribe(filePath: string): Promise<VoiceTranscriptResult> {
    const commandTemplate = this.options.commandTemplate ?? process.env.BOTPILOT_STT_COMMAND?.trim() ?? process.env.ASSYST_STT_COMMAND?.trim();
    if (!commandTemplate) {
      return {
        status: "unavailable",
        provider: "command",
        error: "Set BOTPILOT_STT_COMMAND to enable voice transcription.",
      };
    }

    const startedAt = Date.now();
    try {
      const output = await runCommandLine(
        buildCommandLine(commandTemplate, {
          filePath,
          language: this.options.language ?? process.env.BOTPILOT_STT_LANGUAGE ?? process.env.ASSYST_STT_LANGUAGE ?? "",
        }),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      const text = parseTranscriptOutput(output).trim();
      if (!text) {
        return {
          status: "failed",
          provider: "command",
          durationMs: Date.now() - startedAt,
          error: "Transcription command returned empty output.",
        };
      }

      return {
        status: "ok",
        provider: "command",
        durationMs: Date.now() - startedAt,
        text,
      };
    } catch (error) {
      return {
        status: "failed",
        provider: "command",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export async function enrichVoiceTranscripts(
  message: IncomingMessage,
  transcriber: VoiceTranscriber = new CommandVoiceTranscriber(),
): Promise<void> {
  const voiceAttachments = message.attachments?.filter(isVoiceLikeAttachment) ?? [];
  if (voiceAttachments.length === 0) {
    return;
  }

  const successfulTranscripts: string[] = [];
  for (const attachment of voiceAttachments) {
    const result = attachment.localPath
      ? await transcriber.transcribe(attachment.localPath, attachment)
      : {
          status: "unavailable" as const,
          provider: "local-file",
          error: "Voice attachment was not downloaded.",
        };

    attachment.metadata = {
      ...attachment.metadata,
      transcription: result,
    };

    if (result.status === "ok" && result.text?.trim()) {
      successfulTranscripts.push(result.text.trim());
    }
  }

  if (successfulTranscripts.length > 0) {
    message.text = buildVoiceTranscriptPrompt(message.text, successfulTranscripts);
  }
}

function isVoiceLikeAttachment(attachment: IncomingAttachment): boolean {
  return attachment.kind === "voice" || attachment.kind === "audio";
}

function buildVoiceTranscriptPrompt(originalText: string, transcripts: string[]): string {
  const caption = extractCaption(originalText);
  const transcriptBlock = transcripts
    .map((text, index) => {
      const label = transcripts.length > 1 ? `Voice transcript ${index + 1}` : "Voice transcript";
      return `${label}:\n${text}`;
    })
    .join("\n\n");

  return [caption ? `Caption: ${caption}` : "", transcriptBlock].filter(Boolean).join("\n\n");
}

function extractCaption(text: string): string | undefined {
  const captionLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("Caption:"));
  return captionLine?.slice("Caption:".length).trim() || undefined;
}

function buildCommandLine(template: string, values: { filePath: string; language: string }): string {
  const withPlaceholders = template
    .replaceAll("{file}", shellQuote(values.filePath))
    .replaceAll("{language}", shellQuote(values.language));

  if (template.includes("{file}")) {
    return withPlaceholders;
  }

  return `${withPlaceholders} ${shellQuote(values.filePath)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runCommandLine(commandLine: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-lc", commandLine], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let outputTooLarge = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    timeout.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_TRANSCRIPTION_OUTPUT_BYTES) {
        outputTooLarge = true;
        child.kill("SIGTERM");
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Transcription command timed out after ${timeoutMs}ms.`));
        return;
      }
      if (outputTooLarge) {
        reject(new Error("Transcription command output exceeded the size limit."));
        return;
      }
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error((stderr || `Transcription command exited with ${String(code ?? signal)}.`).trim()));
    });
  });
}

function parseTranscriptOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return extractText(parsed) ?? trimmed;
  } catch {
    return trimmed;
  }
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join("\n").trim() || undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["text", "transcript", "content"]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key];
    }
  }
  if (Array.isArray(record.segments)) {
    return record.segments.map(extractText).filter(Boolean).join(" ").trim() || undefined;
  }
  return undefined;
}
