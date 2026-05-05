import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlChatTranscriptStore } from "../src/electron/ChatTranscriptStore";
import type { ChatMessageEvent } from "../src/electron/chatEvents";

describe("JsonlChatTranscriptStore", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("appends chat events and replays recent history", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "botpilot-transcript-"));
    const store = new JsonlChatTranscriptStore(path.join(tempDir, "chat-transcript.jsonl"));
    const first = event("1", "first");
    const second = event("2", "second");

    await store.append(first);
    await store.append(second);

    expect(await store.readRecent(10)).toEqual([first, second]);
    expect(await store.readRecent(1)).toEqual([second]);
  });

  it("ignores malformed lines while replaying history", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "botpilot-transcript-"));
    const filePath = path.join(tempDir, "chat-transcript.jsonl");
    const valid = event("1", "stored");
    await fs.writeFile(filePath, `not-json\n${JSON.stringify(valid)}\n{"eventId":"bad"}\n`, "utf8");

    const store = new JsonlChatTranscriptStore(filePath);

    expect(await store.readRecent(10)).toEqual([valid]);
  });

  it("replays attachment metadata for voice messages", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "botpilot-transcript-"));
    const store = new JsonlChatTranscriptStore(path.join(tempDir, "chat-transcript.jsonl"));
    const voiceEvent: ChatMessageEvent = {
      ...event("voice", ""),
      attachments: [
        {
          id: "voice-1",
          kind: "voice",
          fileName: "voice.oga",
          mediaUrl: "assyst-media://telegram/voice",
          durationSeconds: 7,
          sizeBytes: 30994,
          transcript: {
            status: "ok",
            text: "распознанный текст",
            provider: "test",
          },
        },
      ],
    };

    await store.append(voiceEvent);

    expect(await store.readRecent(10)).toEqual([voiceEvent]);
  });
});

function event(eventId: string, text: string): ChatMessageEvent {
  return {
    eventId,
    requestId: `request-${eventId}`,
    role: "host",
    kind: "user",
    text,
    timestamp: "2026-05-03T00:00:00.000Z",
    meta: ["host"],
  };
}
