import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("GEULION Idle browser slice", () => {
  it("builds and plays the GEULION game logic through the browser ABI", () => {
    const result = spawnSync(process.execPath, ["examples/idle/game.test.mjs"], {
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("14 assertions passed");
  });

  it("preserves absent, corrupt, incompatible, and failed browser saves", () => {
    const result = spawnSync(process.execPath, ["examples/idle/storage.test.mjs"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("14 assertions passed");
  });
});
