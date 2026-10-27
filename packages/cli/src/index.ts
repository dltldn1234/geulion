import { readFileSync } from "node:fs";
import { tokenizeSource, parseSource } from "@geulion/compiler";

interface CliDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path: string | null;
  readonly range: { readonly start: { readonly line: number; readonly column: number } } | null;
  readonly help: string | null;
}

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
      "",
    ].join("\n"),
  );
}

function printDiagnostics(diagnostics: readonly CliDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    process.stderr.write(`오류 [${diagnostic.code}]: ${diagnostic.message}\n`);
    if (diagnostic.path !== null && diagnostic.range !== null) {
      const { line, column } = diagnostic.range.start;
      process.stderr.write(`\n  ${diagnostic.path}:${line}:${column}\n`);
    }
    if (diagnostic.help !== null) process.stderr.write(`도움말: ${diagnostic.help}\n`);
  }
}

function inspectFile(command: "tokens" | "parse", path: string): number {
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
      printDiagnostics(result.diagnostics);
      return 1;
    }
    return 0;
  }

  const result = parseSource({ path, source });
  if (!result.success) {
    printDiagnostics(result.diagnostics);
    return 1;
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

  if ((command === "tokens" || command === "parse") && args.length === 2) {
    return inspectFile(command, args[1] ?? "");
  }

  if ((command === "tokens" || command === "parse") && args.length !== 2) {
    process.stderr.write(`사용법: geulion ${command} <file.geul>\n`);
    return 2;
  }

  process.stderr.write(`Unknown command: ${args.join(" ")}\nRun 'geulion --help' for usage.\n`);
  return 1;
}
