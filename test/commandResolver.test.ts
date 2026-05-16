import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commandSearchPaths, withCommandSearchPath } from "../src/electron/commandResolver";

describe("commandResolver", () => {
  it("extends sparse app launch PATH values with common CLI locations", () => {
    expect(commandSearchPaths("/usr/bin:/bin")).toEqual([
      "/usr/bin",
      "/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      path.join(os.homedir(), ".local/bin"),
    ]);
  });

  it("builds a child process env with a usable PATH", () => {
    const env = withCommandSearchPath({
      PATH: "/custom/bin",
      KEEP: "value",
      DROP: undefined,
    });

    expect(env.KEEP).toBe("value");
    expect("DROP" in env).toBe(false);
    expect(env.PATH.split(path.delimiter)).toEqual([
      "/custom/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      path.join(os.homedir(), ".local/bin"),
    ]);
  });

  it("keeps the process PATH when a custom env does not override it", () => {
    const firstProcessPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)[0];
    const env = withCommandSearchPath({ KEEP: "value" });

    expect(env.KEEP).toBe("value");
    if (firstProcessPath) {
      expect(env.PATH.split(path.delimiter)[0]).toBe(firstProcessPath);
    }
    expect(env.PATH.split(path.delimiter)).toContain("/opt/homebrew/bin");
  });
});
