export interface BackgroundRuntimeStatus {
  running: boolean;
  startedAt?: string;
  lastTickAt?: string;
  nextTickAt?: string;
  tickCount: number;
  intervalMs: number;
  lastError?: string;
  lastResult?: Record<string, unknown>;
}

export interface BackgroundRuntimeTickResult {
  nextIntervalMs?: number;
  metadata?: Record<string, unknown>;
}

export interface BackgroundRuntimeOptions {
  onTick?: () => BackgroundRuntimeTickResult | Promise<BackgroundRuntimeTickResult | void> | void;
}

export class BackgroundRuntime {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight = false;
  private startedAt: string | undefined;
  private lastTickAt: string | undefined;
  private nextTickAt: string | undefined;
  private tickCount = 0;
  private lastError: string | undefined;
  private lastResult: Record<string, unknown> | undefined;

  constructor(
    private intervalMs = 60_000,
    private readonly options: BackgroundRuntimeOptions = {},
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.startedAt = new Date().toISOString();
    void this.tick();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.nextTickAt = undefined;
  }

  setIntervalMs(intervalMs: number): void {
    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      this.intervalMs = intervalMs;
    }
  }

  status(): BackgroundRuntimeStatus {
    return {
      running: this.running,
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      nextTickAt: this.nextTickAt,
      tickCount: this.tickCount,
      intervalMs: this.intervalMs,
      lastError: this.lastError,
      lastResult: this.lastResult,
    };
  }

  private async tick(): Promise<void> {
    if (!this.running || this.inFlight) {
      return;
    }

    this.clearTimer();
    this.inFlight = true;
    this.lastTickAt = new Date().toISOString();
    this.tickCount += 1;

    try {
      const result = await this.options.onTick?.();
      if (result?.nextIntervalMs && Number.isFinite(result.nextIntervalMs) && result.nextIntervalMs > 0) {
        this.intervalMs = result.nextIntervalMs;
      }
      this.lastResult = result?.metadata;
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastResult = undefined;
    } finally {
      this.inFlight = false;
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    if (!this.running) {
      return;
    }

    this.nextTickAt = new Date(Date.now() + this.intervalMs).toISOString();
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (!this.timer) {
      return;
    }

    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
