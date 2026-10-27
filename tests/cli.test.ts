import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliEntry = fileURLToPath(new URL("../packages/cli/dist/bin.js", import.meta.url));

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliEntry, ...args], { encoding: "utf8" });
}

function withSource<T>(bytes: Uint8Array, body: (path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "geulion-cli-"));
  const path = join(directory, "main.geul");
  writeFileSync(path, bytes);
  try {
    return body(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("GEULION CLI", () => {
  it("prints help", () => {
    const result = runCli("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("geulion --version");
    expect(result.stdout).toContain("geulion tokens <file.geul>");
    expect(result.stdout).toContain("geulion parse <file.geul>");
    expect(result.stdout).toContain("geulion check <file.geul>");
    expect(result.stdout).toContain("geulion emit-js <file.geul>");
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

  it("prints tokens with kind, lexeme, span, and normalized identifiers", () => {
    withSource(new TextEncoder().encode("함수 시작() -> 없음 {}"), (path) => {
      const result = runCli("tokens", path);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"kind":"함수"');
      expect(result.stdout).toContain('"rawLexeme":"시작"');
      expect(result.stdout).toContain('"normalizedName":"시작"');
      expect(result.stdout).toContain('"kind":"EndOfFile"');
    });
  });

  it("prints an AST for a valid source file", () => {
    withSource(new TextEncoder().encode("함수 시작() -> 없음 {}"), (path) => {
      const result = runCli("parse", path);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"success": true');
      expect(result.stdout).toContain('"kind": "Program"');
      expect(result.stderr).toBe("");
    });
  });

  it("reports syntax, invalid UTF-8, and missing-file failures", () => {
    withSource(new TextEncoder().encode("함수 시작() -> 없음 { 상수 값 = }"), (path) => {
      const result = runCli("parse", path);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("오류 [GE1001]");
      expect(result.stderr).toContain(path);
    });

    withSource(Uint8Array.from([0xc3, 0x28]), (path) => {
      const result = runCli("tokens", path);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("오류 [GE0001]");
    });

    const missing = runCli("parse", join(tmpdir(), "does-not-exist.geul"));
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("파일을 읽을 수 없습니다");
  });

  it("checks a valid source and emits executable JavaScript on stdout", () => {
    withSource(readFileSync(new URL("./fixtures/compiler-smoke.geul", import.meta.url)), (path) => {
      const checked = runCli("check", path);
      expect(checked.status).toBe(0);
      expect(checked.stdout).toBe("");
      expect(checked.stderr).toBe("");
      const emitted = runCli("emit-js", path);
      expect(emitted.status).toBe(0);
      expect(emitted.stderr).toBe("");
      const executed = spawnSync(process.execPath, ["--input-type=module", "-"], {
        input: emitted.stdout,
        encoding: "utf8",
        timeout: 5000,
      });
      expect(executed.status).toBe(0);
      expect(executed.stdout).toBe("안녕하세요, GEULION\n42\n");
      expect(executed.stderr).toBe("");
    });
  });

  it.each(["check", "emit-js"])("reports static errors without output code for %s", (command) => {
    withSource(
      new TextEncoder().encode('함수 시작() -> 없음 { 상수 값: 정수 = "문자열" }'),
      (path) => {
        const result = runCli(command, path);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("GE3001");
        expect(result.stderr).toContain("타입 검사");
        expect(result.stderr).toContain("^");
        expect(result.stderr).toContain("도움말:");
      },
    );
    withSource(Uint8Array.from([0xff]), (path) => {
      const result = runCli(command, path);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("GE0001");
    });
  });

  it("validates new command usage and keeps build unsupported", () => {
    expect(runCli("check").status).toBe(2);
    expect(runCli("emit-js").status).toBe(2);
    expect(runCli("build").status).toBe(1);
  });
});
