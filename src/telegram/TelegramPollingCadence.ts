const ACTIVE_INTERVAL_MS = 60_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;
const ABSOLUTE_MAX_INTERVAL_MS = 30 * 60_000;

export class TelegramPollingCadence {
  private lastAnsweredAtMs: number | undefined;
  private backoffStep = 0;

  constructor(lastAnsweredAt?: string) {
    if (lastAnsweredAt) {
      const parsed = Date.parse(lastAnsweredAt);
      this.lastAnsweredAtMs = Number.isFinite(parsed) ? parsed : undefined;
    }
  }

  markAnswered(nowMs = Date.now()): string {
    this.lastAnsweredAtMs = nowMs;
    this.backoffStep = 0;
    return new Date(nowMs).toISOString();
  }

  nextIntervalMs(configuredMaxIntervalMs: number, nowMs = Date.now()): number {
    const maxIntervalMs = clampMaxInterval(configuredMaxIntervalMs);
    if (!this.lastAnsweredAtMs) {
      return maxIntervalMs;
    }

    if (nowMs - this.lastAnsweredAtMs < ACTIVE_WINDOW_MS) {
      this.backoffStep = 0;
      return Math.min(ACTIVE_INTERVAL_MS, maxIntervalMs);
    }

    const intervalMs = Math.min(maxIntervalMs, ACTIVE_INTERVAL_MS * 2 ** (this.backoffStep + 1));
    this.backoffStep += 1;
    return intervalMs;
  }
}

function clampMaxInterval(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return ABSOLUTE_MAX_INTERVAL_MS;
  }

  return Math.min(ABSOLUTE_MAX_INTERVAL_MS, Math.max(ACTIVE_INTERVAL_MS, value));
}
