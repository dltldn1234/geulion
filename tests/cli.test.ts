import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliEntry = fileURLToPath(new URL("../packages/cli/dist/bin.js", import.meta.url));

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliEntry, ...args], { encoding: "utf8" });
}

function runCliAt(directory: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliEntry, ...args], { cwd: directory, encoding: "utf8" });
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
    expect(result.stdout).toContain(
      "geulion check <file.geul> [--language-version 0.2|0.3|0.4] [--root <directory>]",
    );
    expect(result.stdout).toContain("geulion check <file.geul> [--format json]");
    expect(result.stdout).toContain(
      "geulion emit-js <file.geul> [--target browser --language-version 0.3|0.4] [--root <directory>]",
    );
    expect(result.stdout).toContain("geulion run <file.geul>");
    expect(result.stdout).toContain(
      "geulion build <file.geul> [--out-dir <directory>] [--target browser --language-version 0.3|0.4] [--root <directory>]",
    );
  });

  it("prints the package version", () => {
    const result = runCli("--version");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("rejects unsupported commands with a nonzero status", () => {
    const result = runCli("unknown");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command: unknown");
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

  it("prints structured check diagnostics with source ranges and stable JSON errors", () => {
    withSource(
      new TextEncoder().encode("함수 시작() -> 없음 {\n  출력(없는값)\n  출력(다른값)\n}"),
      (path) => {
        const result = runCli("check", path, "--format", "json", "--language-version", "0.1");
        const output = JSON.parse(result.stdout) as {
          version: number;
          success: boolean;
          diagnostics: {
            code: string;
            path: string | null;
            range: { start: { line: number; column: number; utf16Offset: number } } | null;
          }[];
          suppressedCount: number;
        };
        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(output.version).toBe(1);
        expect(output.success).toBe(false);
        expect(output.diagnostics).toHaveLength(2);
        expect(output.suppressedCount).toBe(0);
        expect(output.diagnostics[0]).toMatchObject({
          code: "GE2001",
          path,
          range: { start: { line: 2, column: 6 } },
        });
        expect(output.diagnostics[0]?.range?.start.utf16Offset).toBeGreaterThan(0);
      },
    );

    const missing = runCli(
      "check",
      join(tmpdir(), "missing-geulion-file.geul"),
      "--format",
      "json",
    );
    expect(missing.status).toBe(2);
    expect(missing.stderr).toBe("");
    expect(JSON.parse(missing.stdout)).toMatchObject({
      version: 1,
      success: false,
      diagnostics: [],
      error: { code: "file-read" },
    });

    const invalidFormat = runCli("check", "main.geul", "--format", "xml");
    expect(invalidFormat.status).toBe(2);
    expect(invalidFormat.stderr).toContain("json만 지원");

    const fromStdin = spawnSync(process.execPath, [cliEntry, "check", "-", "--format", "json"], {
      input: "함수 시작() -> 없음 {}",
      encoding: "utf8",
    });
    expect(fromStdin.status).toBe(0);
    expect(JSON.parse(fromStdin.stdout)).toMatchObject({
      version: 1,
      success: true,
      diagnostics: [],
    });
  });

  it("gates v0.2 string utilities behind an explicit language version", () => {
    const source = `함수 시작() -> 없음 {
    출력(문자열길이("가😀é"))
    출력(문자열포함("가나다", "나다"))
    출력(문자열시작("가나다", "가"))
    출력(문자열끝("가나다", "다"))
    출력(문자열포함("가", ""))
    출력(문자열시작("가", "가나"))
    출력(문자열끝("가", "나"))
}`;
    withSource(new TextEncoder().encode(source), (path) => {
      const defaultVersion = runCli("check", path);
      expect(defaultVersion.status).toBe(1);
      expect(defaultVersion.stderr).toContain("GE2001");

      const checked = runCli("check", path, "--language-version", "0.2");
      expect(checked.status).toBe(0);
      expect(checked.stderr).toBe("");

      const run = runCli("run", path, "--language-version", "0.2");
      expect(run.status).toBe(0);
      expect(run.stdout).toBe("4\n참\n참\n참\n참\n거짓\n거짓\n");
      expect(run.stderr).toBe("");

      const emitted = runCli("emit-js", path, "--language-version", "0.2");
      expect(emitted.status).toBe(0);
      const executed = spawnSync(process.execPath, ["--input-type=module", "-"], {
        input: emitted.stdout,
        encoding: "utf8",
      });
      expect(executed.status).toBe(0);
      expect(executed.stdout).toBe(run.stdout);

      const outputDirectory = join(dirname(path), "v02-output");
      const built = runCli(
        "build",
        path,
        "--language-version",
        "0.2",
        "--out-dir",
        outputDirectory,
      );
      expect(built.status).toBe(0);
      const artifact = spawnSync(process.execPath, [join(outputDirectory, "main.mjs")], {
        encoding: "utf8",
      });
      expect(artifact.status).toBe(0);
      expect(artifact.stdout).toBe(run.stdout);
    });
  });

  it("checks and emits v0.3 browser modules while keeping Node execution unsupported", () => {
    const source = `공개 함수 계산(값: 정수) -> 정수 { 반환 값 }
함수 시작() -> 없음 {}`;
    withSource(new TextEncoder().encode(source), (path) => {
      const checked = runCli("check", path, "--language-version", "0.3");
      expect(checked.status).toBe(0);
      expect(checked.stderr).toBe("");
      const emitted = runCli("emit-js", path, "--target", "browser", "--language-version", "0.3");
      expect(emitted.status).toBe(0);
      expect(emitted.stdout).toContain("export function createModule(host)");
      expect(emitted.stdout).not.toContain('from "node:fs"');
      expect(runCli("emit-js", path, "--language-version", "0.3").status).toBe(2);
      expect(runCli("emit-js", path, "--target", "browser").status).toBe(2);
      expect(runCli("run", path, "--language-version", "0.3").status).toBe(2);
      const outputDirectory = join(dirname(path), "browser-output");
      const built = runCli(
        "build",
        path,
        "--target",
        "browser",
        "--language-version",
        "0.3",
        "--out-dir",
        outputDirectory,
      );
      expect(built.status).toBe(0);
      expect(readFileSync(join(outputDirectory, "main.mjs"), "utf8")).toContain(
        "export function createModule(host)",
      );
    });
  });

  it("runs GEULION source in Node and preserves output and runtime exit status", () => {
    withSource(readFileSync(new URL("./fixtures/compiler-smoke.geul", import.meta.url)), (path) => {
      const result = runCli("run", path);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("안녕하세요, GEULION\n42\n");
      expect(result.stderr).toBe("");
    });

    withSource(new TextEncoder().encode("함수 시작() -> 없음 { 출력(1 / 0) }"), (path) => {
      const result = runCli("run", path);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("GE4002");
      expect(result.stderr).toContain(path);
    });

    expect(runCli("run", join(tmpdir(), "missing.geul")).status).toBe(2);
  });

  it("builds a standalone module into a Korean path containing spaces", () => {
    const directory = mkdtempSync(join(tmpdir(), "글리온 CLI "));
    const sourcePath = join(directory, "게임 파일.geul");
    const outputDirectory = join(directory, "배포 결과");
    writeFileSync(
      sourcePath,
      readFileSync(new URL("./fixtures/compiler-smoke.geul", import.meta.url)),
    );
    try {
      const built = runCli("build", sourcePath, "--out-dir", outputDirectory);
      expect(built.status).toBe(0);
      expect(built.stderr).toBe("");
      expect(built.stdout).toContain("빌드 완료:");

      const artifact = join(outputDirectory, "게임 파일.mjs");
      const executed = spawnSync(process.execPath, ["--enable-source-maps", artifact], {
        encoding: "utf8",
        timeout: 5000,
      });
      expect(executed.status).toBe(0);
      expect(executed.stdout).toBe("안녕하세요, GEULION\n42\n");
      expect(executed.stderr).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("builds to dist by default and rejects compile failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "geulion-build-"));
    const sourcePath = join(directory, "main.geul");
    writeFileSync(sourcePath, "함수 시작() -> 없음 { 출력(42) }");
    try {
      const built = runCliAt(directory, "build", sourcePath);
      expect(built.status).toBe(0);
      const artifact = join(directory, "dist", "main.mjs");
      const executed = spawnSync(process.execPath, [artifact], { encoding: "utf8", timeout: 5000 });
      expect(executed.status).toBe(0);
      expect(executed.stdout).toBe("42\n");

      writeFileSync(sourcePath, '함수 시작() -> 없음 { 상수 값: 정수 = "문자열" }');
      const failed = runCliAt(directory, "build", sourcePath);
      expect(failed.status).toBe(1);
      expect(failed.stderr).toContain("GE3001");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

  it("validates run and build command usage", () => {
    expect(runCli("check").status).toBe(2);
    expect(runCli("emit-js").status).toBe(2);
    expect(runCli("run").status).toBe(2);
    expect(runCli("build").status).toBe(2);
    expect(runCli("build", "main.geul", "--out-dir").status).toBe(2);
    expect(runCli("build", "main.geul", "--wrong", "dist").status).toBe(2);
    expect(runCli("check", "main.geul", "--language-version").status).toBe(2);
    expect(runCli("check", "main.geul", "--language-version", "0.5").status).toBe(2);
    expect(runCli("check", "main.geul", "--root", "project").status).toBe(2);
    expect(runCli("tokens", "main.geul", "--language-version", "0.2").status).toBe(2);
    expect(runCli("check", "main.geul", "--target", "browser").status).toBe(2);
    expect(runCli("build", "main.geul", "--target", "node").status).toBe(2);
  });

  it("checks, emits, runs, and builds a root-confined v0.4 project", () => {
    const directory = mkdtempSync(join(tmpdir(), "geulion-v04-cli-"));
    const sourceDirectory = join(directory, "src");
    const entry = join(sourceDirectory, "main.geul");
    const library = join(directory, "lib.geul");
    const buildDirectory = join(directory, "build");
    mkdirSync(sourceDirectory);
    writeFileSync(
      entry,
      '가져오기 "../lib.geul" 별칭 도구\n함수 시작() -> 없음 { 출력(도구.값()) }',
    );
    writeFileSync(library, "공개 함수 값() -> 정수 { 반환 42 }");
    try {
      const check = runCli("check", entry, "--language-version", "0.4", "--root", directory);
      expect(check.status).toBe(0);
      expect(check.stderr).toBe("");

      const emitted = runCli("emit-js", entry, "--language-version", "0.4", "--root", directory);
      expect(emitted.status).toBe(0);
      const executed = spawnSync(process.execPath, ["--input-type=module", "-"], {
        input: emitted.stdout,
        encoding: "utf8",
        timeout: 5000,
      });
      expect(executed.status).toBe(0);
      expect(executed.stdout).toBe("42\n");

      const run = runCli("run", entry, "--language-version", "0.4", "--root", directory);
      expect(run.status).toBe(0);
      expect(run.stdout).toBe("42\n");

      const build = runCli(
        "build",
        entry,
        "--language-version",
        "0.4",
        "--root",
        directory,
        "--out-dir",
        buildDirectory,
      );
      expect(build.status).toBe(0);
      const artifact = spawnSync(process.execPath, [join(buildDirectory, "main.mjs")], {
        encoding: "utf8",
        timeout: 5000,
      });
      expect(artifact.status).toBe(0);
      expect(artifact.stdout).toBe("42\n");

      writeFileSync(
        entry,
        '가져오기 "../lib.geul" 별칭 도구\n공개 함수 결과() -> 정수 { 반환 도구.값() }',
      );
      const browser = runCli(
        "emit-js",
        entry,
        "--language-version",
        "0.4",
        "--target",
        "browser",
        "--root",
        directory,
      );
      expect(browser.status).toBe(0);
      expect(browser.stdout).not.toContain('from "node:fs"');
      expect(browser.stdout).toContain("createModule");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects v0.4 imports that traverse symlinks or mismatch file case", () => {
    const directory = mkdtempSync(join(tmpdir(), "geulion-v04-guard-"));
    const entry = join(directory, "main.geul");
    const target = join(directory, "real.geul");
    const link = join(directory, "linked.geul");
    writeFileSync(entry, '가져오기 "./linked.geul" 별칭 도구\n함수 시작() -> 없음 {}');
    writeFileSync(target, "공개 함수 값() -> 정수 { 반환 1 }");
    symlinkSync(target, link);
    try {
      const linked = runCli("check", entry, "--language-version", "0.4");
      expect(linked.status).toBe(2);
      expect(linked.stderr).toContain("심볼릭 링크");

      writeFileSync(entry, '가져오기 "./REAL.geul" 별칭 도구\n함수 시작() -> 없음 {}');
      const wrongCase = runCli("check", entry, "--language-version", "0.4");
      expect(wrongCase.status).toBe(2);
      expect(wrongCase.stderr).toContain("대소문자");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns project diagnostics for missing modules and root escapes", () => {
    const directory = mkdtempSync(join(tmpdir(), "geulion-v04-paths-"));
    const entry = join(directory, "main.geul");
    try {
      writeFileSync(entry, '가져오기 "./missing.geul" 별칭 도구\n함수 시작() -> 없음 {}');
      const missing = runCli("check", entry, "--language-version", "0.4", "--format", "json");
      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stdout)).toMatchObject({ success: false });
      expect(missing.stdout).toContain("GE2006");

      writeFileSync(entry, '가져오기 "../escape.geul" 별칭 도구\n함수 시작() -> 없음 {}');
      const escape = runCli("check", entry, "--language-version", "0.4");
      expect(escape.status).toBe(1);
      expect(escape.stderr).toContain("GE2007");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
