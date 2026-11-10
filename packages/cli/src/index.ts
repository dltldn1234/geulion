import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  tokenizeSource,
  parseSource,
  checkSource,
  compileSource,
  compileProjectSourceGraph,
  analyzeProjectSourceGraph,
  renderDiagnostics,
} from "@geulion/compiler";
import { loadProjectFiles } from "./project-loader.js";

interface PackageMetadata {
  readonly version: string;
}

type LanguageVersion = "0.1" | "0.2" | "0.3" | "0.4";
type NodeLanguageVersion = Exclude<LanguageVersion, "0.3">;
type CompilationTarget = "node" | "browser";

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
      "  geulion check <file.geul> [--language-version 0.2|0.3|0.4] [--root <directory>]",
      "  geulion check <file.geul> [--format json]",
      "  geulion check - [--format json]  # read source from stdin",
      "  geulion emit-js <file.geul> [--target browser --language-version 0.3|0.4] [--root <directory>]",
      "  geulion run <file.geul> [--language-version 0.2|0.4] [--root <directory>]",
      "  geulion build <file.geul> [--out-dir <directory>] [--target browser --language-version 0.3|0.4] [--root <directory>]",
      "",
    ].join("\n"),
  );
}

function readSource(path: string): Buffer | undefined {
  try {
    return path === "-" ? readFileSync(0) : readFileSync(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`오류: 파일을 읽을 수 없습니다: ${path}\n${message}\n`);
    return undefined;
  }
}

type CompiledFile =
  | { readonly success: true; readonly code: string }
  | { readonly success: false; readonly status: number };

function compileFile(
  path: string,
  languageVersion: LanguageVersion,
  target: CompilationTarget,
  projectRoot?: string,
): CompiledFile {
  if (languageVersion === "0.4") {
    const loaded = loadProjectFiles(path, projectRoot);
    if (!loaded.success) {
      if ("message" in loaded) {
        process.stderr.write(`오류: 프로젝트 파일을 불러올 수 없습니다.\n${loaded.message}\n`);
        return { success: false, status: 2 };
      }
      return {
        success: false,
        status: printProjectDiagnostics(loaded.diagnostics, loaded.suppressedCount, loaded.sources),
      };
    }
    const result = compileProjectSourceGraph(loaded.graph, target);
    if (!result.success)
      return {
        success: false,
        status: printProjectDiagnostics(
          result.diagnostics,
          result.suppressedCount,
          new Map(loaded.graph.modules.map(({ path, source }) => [path, source])),
        ),
      };
    return { success: true, code: result.code };
  }
  const source = readSource(path);
  if (source === undefined) return { success: false, status: 2 };

  const result =
    target === "browser"
      ? compileSource({ path, source, target: "browser", languageVersion: "0.3" })
      : compileSource({
          path,
          source,
          target: "node",
          languageVersion: languageVersion as Exclude<NodeLanguageVersion, "0.4">,
        });
  if (!result.success) {
    return {
      success: false,
      status: printDiagnostics(result.diagnostics, source, result.suppressedCount),
    };
  }
  return { success: true, code: result.code };
}

function runFile(path: string, languageVersion: NodeLanguageVersion, projectRoot?: string): number {
  const result = compileFile(path, languageVersion, "node", projectRoot);
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
  languageVersion: LanguageVersion,
  target: CompilationTarget,
  projectRoot?: string,
): number {
  const result = compileFile(path, languageVersion, target, projectRoot);
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

function printProjectDiagnostics(
  diagnostics: Parameters<typeof renderDiagnostics>[0],
  suppressedCount = 0,
  sources: ReadonlyMap<string, Uint8Array> = new Map(),
): number {
  for (const diagnostic of diagnostics) {
    let sourceText: string | undefined;
    const source = diagnostic.path === null ? undefined : sources.get(diagnostic.path);
    if (source) {
      try {
        sourceText = new TextDecoder("utf-8", { fatal: true }).decode(source);
      } catch {
        /* Invalid source bytes have ranges but no source snippet. */
      }
    }
    process.stderr.write(renderDiagnostics([diagnostic], sourceText));
  }
  if (suppressedCount > 0) process.stderr.write(renderDiagnostics([], undefined, suppressedCount));
  return diagnostics.some((diagnostic) => diagnostic.phase === "internal") ? 2 : 1;
}

function inspectProjectFile(
  command: "check" | "emit-js",
  path: string,
  target: CompilationTarget,
  format: "text" | "json",
  projectRoot?: string,
): number {
  const loaded = loadProjectFiles(path, projectRoot);
  if ("message" in loaded) {
    if (command === "check" && format === "json")
      process.stdout.write(
        `${JSON.stringify({ version: 1, success: false, diagnostics: [], suppressedCount: 0, error: { code: "file-read", message: loaded.message } })}\n`,
      );
    else process.stderr.write(`오류: 프로젝트 파일을 불러올 수 없습니다.\n${loaded.message}\n`);
    return 2;
  }
  if (!loaded.success) {
    if (command === "check" && format === "json")
      process.stdout.write(
        `${JSON.stringify({ version: 1, success: false, diagnostics: loaded.diagnostics, suppressedCount: loaded.suppressedCount })}\n`,
      );
    else printProjectDiagnostics(loaded.diagnostics, loaded.suppressedCount, loaded.sources);
    return loaded.diagnostics.some((diagnostic) => diagnostic.phase === "internal") ? 2 : 1;
  }

  const result =
    command === "check"
      ? analyzeProjectSourceGraph(loaded.graph, target)
      : compileProjectSourceGraph(loaded.graph, target);
  if (command === "check" && format === "json") {
    process.stdout.write(
      `${JSON.stringify({ version: 1, success: result.success, diagnostics: result.diagnostics, suppressedCount: result.suppressedCount })}\n`,
    );
    return result.success
      ? 0
      : result.diagnostics.some((diagnostic) => diagnostic.phase === "internal")
        ? 2
        : 1;
  }
  if (result.success) {
    if ("code" in result) process.stdout.write(result.code);
    return 0;
  }
  return printProjectDiagnostics(
    result.diagnostics,
    result.suppressedCount,
    new Map(loaded.graph.modules.map(({ path, source }) => [path, source])),
  );
}

function inspectFile(
  command: "tokens" | "parse" | "check" | "emit-js",
  path: string,
  languageVersion: LanguageVersion,
  target: CompilationTarget,
  format: "text" | "json" = "text",
  projectRoot?: string,
): number {
  if (languageVersion === "0.4" && (command === "check" || command === "emit-js"))
    return inspectProjectFile(command, path, target, format, projectRoot);

  let source: Buffer;
  try {
    source = path === "-" ? readFileSync(0) : readFileSync(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (command === "check" && format === "json") {
      process.stdout.write(
        `${JSON.stringify({ version: 1, success: false, diagnostics: [], suppressedCount: 0, error: { code: "file-read", message } })}\n`,
      );
      return 2;
    }
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
    if (format === "json") {
      process.stdout.write(
        `${JSON.stringify({ version: 1, success: result.success, diagnostics: result.diagnostics, suppressedCount: result.suppressedCount })}\n`,
      );
      return result.success
        ? 0
        : result.diagnostics.some((diagnostic) => diagnostic.phase === "internal")
          ? 2
          : 1;
    }
    return result.success
      ? 0
      : printDiagnostics(result.diagnostics, source, result.suppressedCount);
  }
  if (command === "emit-js") {
    const result =
      target === "browser"
        ? compileSource({ path, source, target: "browser", languageVersion: "0.3" })
        : compileSource({
            path,
            source,
            target: "node",
            languageVersion: languageVersion as Exclude<NodeLanguageVersion, "0.4">,
          });
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
    let target: CompilationTarget = "node";
    let hasTarget = false;
    let format: "text" | "json" = "text";
    let hasFormat = false;
    let projectRoot: string | undefined;
    let hasProjectRoot = false;
    for (let index = 2; index < args.length; index += 1) {
      const option = args[index];
      if (command === "check" && option === "--format" && !hasFormat) {
        if (args[index + 1] !== "json") {
          process.stderr.write("오류: check --format은 json만 지원합니다.\n");
          return 2;
        }
        format = "json";
        hasFormat = true;
        index += 1;
      } else if (option === "--language-version" && !hasLanguageVersion) {
        const value = args[index + 1];
        if (value !== "0.1" && value !== "0.2" && value !== "0.3") {
          if (value !== "0.4") {
            process.stderr.write(
              "오류: --language-version은 0.1, 0.2, 0.3 또는 0.4이어야 합니다.\n",
            );
            return 2;
          }
        }
        languageVersion = value;
        hasLanguageVersion = true;
        index += 1;
      } else if (
        option === "--root" &&
        !hasProjectRoot &&
        command !== "tokens" &&
        command !== "parse"
      ) {
        const value = args[index + 1];
        if (!value) {
          process.stderr.write("오류: --root 뒤에 프로젝트 디렉터리를 지정해야 합니다.\n");
          return 2;
        }
        projectRoot = value;
        hasProjectRoot = true;
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
      } else if (
        (command === "emit-js" || command === "build") &&
        option === "--target" &&
        !hasTarget
      ) {
        const value = args[index + 1];
        if (value !== "browser") {
          process.stderr.write("오류: --target에는 browser만 지정할 수 있습니다.\n");
          return 2;
        }
        target = "browser";
        hasTarget = true;
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
    if (hasProjectRoot && languageVersion !== "0.4") {
      process.stderr.write("오류: --root는 언어 버전 0.4 프로젝트에서만 사용할 수 있습니다.\n");
      return 2;
    }
    if (hasTarget && languageVersion !== "0.3" && languageVersion !== "0.4") {
      process.stderr.write(
        "오류: browser 대상은 --language-version 0.3 또는 0.4와 함께 사용해야 합니다.\n",
      );
      return 2;
    }
    if (!hasTarget && languageVersion === "0.3" && (command === "emit-js" || command === "build")) {
      process.stderr.write("오류: v0.3 코드 생성에는 --target browser가 필요합니다.\n");
      return 2;
    }
    if (command === "run") {
      if (languageVersion === "0.3") {
        process.stderr.write("오류: 언어 버전 0.3은 현재 check 명령만 지원합니다.\n");
        return 2;
      }
      return runFile(path, languageVersion, projectRoot);
    }
    if (command === "build") {
      return buildFile(path, outputDirectory, languageVersion, target, projectRoot);
    }
    return inspectFile(command, path, languageVersion, target, format, projectRoot);
  }

  process.stderr.write(`Unknown command: ${args.join(" ")}\nRun 'geulion --help' for usage.\n`);
  return 1;
}
