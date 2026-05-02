import { describe, expect, it } from "vitest";
import { BackgroundRuntime } from "../src/electron/backgroundRuntime";

describe("BackgroundRuntime", () => {
  it("starts, reports ticks, and stops", () => {
    const runtime = new BackgroundRuntime(60_000);

    expect(runtime.status().running).toBe(false);

    runtime.start();
    const started = runtime.status();

    expect(started.running).toBe(true);
    expect(started.startedAt).toBeDefined();
    expect(started.lastTickAt).toBeDefined();
    expect(started.tickCount).toBe(1);

    runtime.stop();

    expect(runtime.status().running).toBe(false);
  });
});
