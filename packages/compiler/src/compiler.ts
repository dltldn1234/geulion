import { createDiagnostic, SourceFile, type Diagnostic } from "@geulion/ast";
import { analyzeProgram, type AnalysisResult } from "@geulion/semantic";
import { generateJavaScript } from "@geulion/codegen-js";
import { parseSource } from "./frontend.js";

export interface SourceInput {
  readonly path: string;
  readonly source: Uint8Array;
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
    return analyzeProgram(parsed.ast, input.path);
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
  input: SourceInput & { readonly target?: "node" },
): CompilationResult {
  try {
    const checked = checkSource(input);
    if (!checked.success) return checked;
    const sourceText = SourceFile.fromBytes(input.path, input.source).text;
    const generated = generateJavaScript(checked.program, { sourceText });
    return { success: true, ...generated, diagnostics: [], suppressedCount: 0 };
  } catch {
    return internalFailure();
  }
}
