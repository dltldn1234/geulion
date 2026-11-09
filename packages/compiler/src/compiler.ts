import { createDiagnostic, SourceFile, type Diagnostic } from "@geulion/ast";
import { analyzeProgram, type AnalysisResult, type LanguageVersion } from "@geulion/semantic";
import { generateJavaScript } from "@geulion/codegen-js";
import { parseSource } from "./frontend.js";

export type { LanguageVersion } from "@geulion/semantic";

export interface SourceInput {
  readonly path: string;
  readonly source: Uint8Array;
  readonly languageVersion?: LanguageVersion;
}

export interface CompilationFailure {
  readonly success: false;
  readonly diagnostics: readonly Diagnostic[];
  readonly suppressedCount: number;
}

function internalFailure(): CompilationFailure {
  return {
    success: false,
    suppressedCount: 0,
    diagnostics: [
      createDiagnostic({
        code: "GE9001",
        phase: "internal",
        message: "컴파일러 내부 오류가 발생했습니다.",
        path: null,
        range: null,
        help: null,
      }),
    ],
  };
}

export function checkSource(input: SourceInput): AnalysisResult {
  try {
    const parsed = parseSource(input);
    if (!parsed.success)
      return {
        success: false,
        diagnostics: parsed.diagnostics,
        suppressedCount: parsed.suppressedCount,
      };
    return analyzeProgram(parsed.ast, input.path, input.languageVersion ?? "0.1");
  } catch {
    return internalFailure();
  }
}

export type CompilationResult =
  | ({
      readonly success: true;
      readonly diagnostics: readonly [];
      readonly suppressedCount: 0;
    } & ReturnType<typeof generateJavaScript>)
  | CompilationFailure;

export function compileSource(
  input: SourceInput & {
    readonly target?: "node";
    readonly languageVersion?: "0.1" | "0.2";
  },
): CompilationResult {
  try {
    const requestedVersion = input.languageVersion as LanguageVersion | undefined;
    if (requestedVersion === "0.3") {
      return {
        success: false,
        suppressedCount: 0,
        diagnostics: [
          createDiagnostic({
            code: "GE2004",
            phase: "resolve",
            message: "v0.3은 현재 Node 대상 컴파일을 지원하지 않습니다.",
            path: input.path,
            range: null,
            help: "`--language-version 0.1` 또는 `0.2`를 선택하거나 브라우저 대상 구현을 기다리세요.",
          }),
        ],
      };
    }
    const checked = checkSource(input);
    if (!checked.success) return checked;
    const sourceText = SourceFile.fromBytes(input.path, input.source).text;
    const generated = generateJavaScript(checked.program, { sourceText });
    return { success: true, ...generated, diagnostics: [], suppressedCount: 0 };
  } catch {
    return internalFailure();
  }
}
