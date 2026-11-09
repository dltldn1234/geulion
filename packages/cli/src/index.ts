import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  tokenizeSource,
  parseSource,
  checkSource,
  compileSource,
  renderDiagnostics,
} from "@geulion/compiler";

interface PackageMetadata {
  readonly version: string;
}

type LanguageVersion = "0.1" | "0.2" | "0.3";
type NodeLanguageVersion = Exclude<LanguageVersion, "0.3">;

function getVersion(): string {
  const packageJson = new URL("../package.json", import.meta.url);
  const metadata = JSON.parse(readFileSync(packageJson, "utf8")) as PackageMetadata;

  return metadata.version;
}

function printHelp(): void {
  process.stdout.write(
    [
      "GEULION (글리온)",
      "A Korean-first general-purpose programming language.",
      "",
      "Usage:",
      "  geulion --help",
      "  geulion --version",
      "  geulion tokens <file.geul>",
      "  geulion parse <file.geul>",
      "  geulion check <file.geul> [--language-version 0.2|0.3]",
      "  geulion emit-js <file.geul> [--language-version 0.2]",
      "  geulion run <file.geul> [--language-version 0.2]",
      "  geulion build <file.geul> [--out-dir <directory>] [--language-version 0.2]",
      "",
    ].join("\n"),
  );
}

function readSource(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`오류: 파일을 읽을 수 없습니다: ${path}\n${message}\n`);
    return undefined;
  }
}

type CompiledFile =
  | { readonly success: true; readonly code: string }
  | { readonly success: false; readonly status: number };

function compileFile(path: string, languageVersion: NodeLanguageVersion): CompiledFile {
  const source = readSource(path);
  if (source === undefined) return { success: false, status: 2 };

  const result = compileSource({ path, source, target: "node", languageVersion });
  if (!result.success) {
    return {
      success: false,
      status: printDiagnostics(result.diagnostics, source, result.suppressedCount),
    };
  }
  return { success: true, code: result.code };
}

function runFile(path: string, languageVersion: NodeLanguageVersion): number {
  const result = compileFile(path, languageVersion);
  if (!result.success) return result.status;

  let temporaryDirectory: string | undefined;
  try {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "geulion-run-"));
    const artifact = join(temporaryDirectory, "program.mjs");
    writeFileSync(artifact, result.code, "utf8");

    const child = spawnSync(process.execPath, ["--enable-source-maps", artifact], {
      stdio: "inherit",
      windowsHide: true,
    });
    if (child.error) {
      process.stderr.write(
        `오류: GEULION 프로그램을 실행할 수 없습니다.\n${child.error.message}\n`,
      );
      return 2;
    }
    return child.status ?? 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`오류: 임시 실행 파일을 준비할 수 없습니다.\n${message}\n`);
    return 2;
  } finally {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function buildFile(
  path: string,
  outputDirectory: string,
  languageVersion: NodeLanguageVersion,
): number {
  const result = compileFile(path, languageVersion);
  if (!result.success) return result.status;

  const outputPath = resolve(outputDirectory, `${basename(path).replace(/\.geul$/u, "")}.mjs`);
  try {
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(outputPath, result.code, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`오류: 빌드 결과를 저장할 수 없습니다: ${outputPath}\n${message}\n`);
    return 2;
  }

  process.stdout.write(`빌드 완료: ${outputPath}\n`);
  return 0;
}

function printDiagnostics(
  diagnostics: Parameters<typeof renderDiagnostics>[0],
  source: Uint8Array,
  suppressedCount = 0,
): number {
  let text: string | undefined;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch {
    /* Invalid encoding diagnostics have positions but no decoded source snippet. */
  }
  process.stderr.write(renderDiagnostics(diagnostics, text, suppressedCount));
  return diagnostics.some((d) => d.phase === "internal") ? 2 : 1;
}

function inspectFile(
  command: "tokens" | "parse" | "check" | "emit-js",
  path: string,
  languageVersion: LanguageVersion,
): number {
  let source: Buffer;
  try {
    source = readFileSync(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`오류: 파일을 읽을 수 없습니다: ${path}\n${message}\n`);
    return 2;
  }

  if (command === "tokens") {
    const result = tokenizeSource({ path, source });
    for (const token of result.tokens) {
      process.stdout.write(`${JSON.stringify(token)}\n`);
    }
    if (!result.success) {
      return printDiagnostics(result.diagnostics, source, result.suppressedCount);
    }
    return 0;
  }

  if (command === "check") {
    const result = checkSource({ path, source, languageVersion });
    return result.success
      ? 0
      : printDiagnostics(result.diagnostics, source, result.suppressedCount);
  }
  if (command === "emit-js") {
    if (languageVersion === "0.3") {
      process.stderr.write("오류: 언어 버전 0.3은 현재 Node 대상 컴파일을 지원하지 않습니다.\n");
      return 2;
    }
    const result = compileSource({ path, source, target: "node", languageVersion });
    if (!result.success)
      return printDiagnostics(result.diagnostics, source, result.suppressedCount);
    process.stdout.write(result.code);
    return 0;
  }

  const result = parseSource({ path, source });
  if (!result.success) {
    return printDiagnostics(result.diagnostics, source, result.suppressedCount);
  }
  process.stdout.write(`${JSON.stringify({ success: true, ast: result.ast }, null, 2)}\n`);
  return 0;
}

export function runCli(args: readonly string[]): number {
  const command = args[0];

  if (args.length === 0 || (args.length === 1 && (command === "--help" || command === "-h"))) {
    printHelp();
    return 0;
  }

  if (args.length === 1 && (command === "--version" || command === "-v")) {
    process.stdout.write(`${getVersion()}\n`);
    return 0;
  }

  if (
    command === "tokens" ||
    command === "parse" ||
    command === "check" ||
    command === "emit-js" ||
    command === "run" ||
    command === "build"
  ) {
    const path = args[1];
    let outputDirectory = "dist";
    let languageVersion: LanguageVersion = "0.1";
    let hasLanguageVersion = false;
    let hasOutputDirectory = false;
    for (let index = 2; index < args.length; index += 1) {
      const option = args[index];
      if (option === "--language-version" && !hasLanguageVersion) {
        const value = args[index + 1];
        if (value !== "0.1" && value !== "0.2" && value !== "0.3") {
          process.stderr.write("오류: --language-version은 0.1, 0.2 또는 0.3이어야 합니다.\n");
          return 2;
        }
        languageVersion = value;
        hasLanguageVersion = true;
        index += 1;
      } else if (command === "build" && option === "--out-dir" && !hasOutputDirectory) {
        const value = args[index + 1];
        if (!value) {
          process.stderr.write(
            "사용법: geulion build <file.geul> [--out-dir <directory>] [--language-version 0.2]\n",
          );
          return 2;
        }
        outputDirectory = value;
        hasOutputDirectory = true;
        index += 1;
      } else {
        process.stderr.write(
          `사용법: geulion ${command} <file.geul>${command === "build" ? " [--out-dir <directory>]" : ""} [--language-version 0.2]\n`,
        );
        return 2;
      }
    }
    if (!path) {
      process.stderr.write(`사용법: geulion ${command} <file.geul> [--language-version 0.2]\n`);
      return 2;
    }
    if ((command === "tokens" || command === "parse") && hasLanguageVersion) {
      process.stderr.write(`오류: ${command} 명령은 언어 버전 선택을 사용하지 않습니다.\n`);
      return 2;
    }
    if (command === "run") {
      if (languageVersion === "0.3") {
        process.stderr.write("오류: 언어 버전 0.3은 현재 check 명령만 지원합니다.\n");
        return 2;
      }
      return runFile(path, languageVersion);
    }
    if (command === "build") {
      if (languageVersion === "0.3") {
        process.stderr.write("오류: 언어 버전 0.3은 현재 check 명령만 지원합니다.\n");
        return 2;
      }
      return buildFile(path, outputDirectory, languageVersion);
    }
    return inspectFile(command, path, languageVersion);
  }

  process.stderr.write(`Unknown command: ${args.join(" ")}\nRun 'geulion --help' for usage.\n`);
  return 1;
}
