import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliEntry = fileURLToPath(new URL("../packages/cli/dist/bin.js", import.meta.url));

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliEntry, ...args], { encoding: "utf8" });
}

describe("GEULION CLI", () => {
  it("prints help", () => {
    const result = runCli("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("geulion --version");
  });

  it("prints the package version", () => {
    const result = runCli("--version");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("rejects unsupported commands with a nonzero status", () => {
    const result = runCli("run");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command: run");
    expect(result.stderr).toContain("geulion --help");
  });
});
