import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../src/domain/types";
import { enrichVoiceTranscripts, type VoiceTranscriber } from "../src/electron/voiceTranscription";

describe("enrichVoiceTranscripts", () => {
  it("stores voice transcripts on attachment metadata and makes the transcript the task text", async () => {
    const message: IncomingMessage = {
      id: "telegram:1:2",
      transport: "telegram",
      text: "Telegram message: voice.\nAttachments:\n- voice: /tmp/voice.oga\nRespond naturally.",
      receivedAt: "2026-05-03T00:00:00.000Z",
      attachments: [
        {
          id: "voice-1",
          kind: "voice",
          localPath: "/tmp/voice.oga",
          metadata: {
            duration: 12,
          },
        },
      ],
    };
    const transcriber: VoiceTranscriber = {
      transcribe: async () => ({
        status: "ok",
        text: "сделай кнопку воспроизведения",
        provider: "test",
        durationMs: 10,
      }),
    };

    await enrichVoiceTranscripts(message, transcriber);

    expect(message.text).toBe("Voice transcript:\nсделай кнопку воспроизведения");
    expect(message.attachments?.[0]?.metadata?.transcription).toMatchObject({
      status: "ok",
      text: "сделай кнопку воспроизведения",
      provider: "test",
    });
  });

  it("preserves captions when adding a voice transcript", async () => {
    const message: IncomingMessage = {
      id: "telegram:1:2",
      transport: "telegram",
      text: "Telegram message: voice, caption.\nCaption: срочно\nAttachments:\n- voice: /tmp/voice.oga",
      receivedAt: "2026-05-03T00:00:00.000Z",
      attachments: [
        {
          id: "voice-1",
          kind: "voice",
          localPath: "/tmp/voice.oga",
        },
      ],
    };
    const transcriber: VoiceTranscriber = {
      transcribe: async () => ({
        status: "ok",
        text: "проверь интерфейс",
      }),
    };

    await enrichVoiceTranscripts(message, transcriber);

    expect(message.text).toBe("Caption: срочно\n\nVoice transcript:\nпроверь интерфейс");
  });
});
