import { describe, expect, it } from "vitest";
import { isExplicitRestartRequest } from "../src/control/restartRequest";

describe("isExplicitRestartRequest", () => {
  it("accepts explicit restart commands", () => {
    expect(isExplicitRestartRequest("/restart")).toBe(true);
    expect(isExplicitRestartRequest("/restart@botpilot_bot")).toBe(true);
    expect(isExplicitRestartRequest("перезапусти себя")).toBe(true);
    expect(isExplicitRestartRequest("перезапусти приложение пожалуйста")).toBe(true);
    expect(isExplicitRestartRequest("restart botpilot please")).toBe(true);
  });

  it("rejects discussion and negated restart text", () => {
    expect(isExplicitRestartRequest("сделай безопасный рестарт, но не перезапускайся")).toBe(false);
    expect(isExplicitRestartRequest("как работает restart?")).toBe(false);
    expect(isExplicitRestartRequest("do not restart")).toBe(false);
  });
});
