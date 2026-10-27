import { readFileSync } from "node:fs";
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
      "  geulion check <file.geul>",
      "  geulion emit-js <file.geul>",
      "",
    ].join("\n"),
  );
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

function inspectFile(command: "tokens" | "parse" | "check" | "emit-js", path: string): number {
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
    const result = checkSource({ path, source });
    return result.success
      ? 0
      : printDiagnostics(result.diagnostics, source, result.suppressedCount);
  }
  if (command === "emit-js") {
    const result = compileSource({ path, source, target: "node" });
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
    (command === "tokens" || command === "parse" || command === "check" || command === "emit-js") &&
    args.length === 2
  ) {
    return inspectFile(command, args[1] ?? "");
  }

  if (
    (command === "tokens" || command === "parse" || command === "check" || command === "emit-js") &&
    args.length !== 2
  ) {
    process.stderr.write(`사용법: geulion ${command} <file.geul>\n`);
    return 2;
  }

  process.stderr.write(`Unknown command: ${args.join(" ")}\nRun 'geulion --help' for usage.\n`);
  return 1;
}
