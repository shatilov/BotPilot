import { describe, expect, it } from "vitest";
import { TelegramPollingCadence } from "../src/telegram/TelegramPollingCadence";

describe("TelegramPollingCadence", () => {
  it("uses max interval before the first answer", () => {
    const cadence = new TelegramPollingCadence();

    expect(cadence.nextIntervalMs(30 * 60_000, 0)).toBe(30 * 60_000);
  });

  it("polls every minute for five minutes after an answer", () => {
    const cadence = new TelegramPollingCadence();
    cadence.markAnswered(1_000);

    expect(cadence.nextIntervalMs(30 * 60_000, 1_000 + 60_000)).toBe(60_000);
    expect(cadence.nextIntervalMs(30 * 60_000, 1_000 + 4 * 60_000)).toBe(60_000);
  });

  it("backs off after the active window up to the configured maximum", () => {
    const cadence = new TelegramPollingCadence();
    cadence.markAnswered(1_000);

    expect(cadence.nextIntervalMs(30 * 60_000, 1_000 + 6 * 60_000)).toBe(2 * 60_000);
    expect(cadence.nextIntervalMs(30 * 60_000, 1_000 + 8 * 60_000)).toBe(4 * 60_000);
    expect(cadence.nextIntervalMs(3 * 60_000, 1_000 + 12 * 60_000)).toBe(3 * 60_000);
  });
});
