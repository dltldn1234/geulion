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

export type NodeCompileInput = SourceInput & {
  readonly target?: "node";
  readonly languageVersion?: "0.1" | "0.2";
};

export type BrowserCompileInput = SourceInput & {
  readonly target: "browser";
  readonly languageVersion: "0.3";
};

export type CompileInput = NodeCompileInput | BrowserCompileInput;

function compilationDiagnostic(
  code: "GE2004" | "GE2005",
  path: string,
  message: string,
  help: string,
): CompilationFailure {
  return {
    success: false,
    suppressedCount: 0,
    diagnostics: [createDiagnostic({ code, phase: "resolve", message, path, range: null, help })],
  };
}

export function compileSource(input: CompileInput): CompilationResult {
  try {
    const runtimeInput = input as SourceInput & { readonly target?: unknown };
    const target = runtimeInput.target ?? "node";
    const languageVersion = input.languageVersion ?? "0.1";
    if (
      (languageVersion !== "0.1" && languageVersion !== "0.2" && languageVersion !== "0.3") ||
      (target !== "node" && target !== "browser") ||
      (target === "node" && languageVersion === "0.3") ||
      (target === "browser" && languageVersion !== "0.3")
    )
      return compilationDiagnostic(
        "GE2004",
        input.path,
        "지원하지 않는 언어 버전과 컴파일 대상 조합입니다.",
        "Node 대상에는 v0.1 또는 v0.2를, 브라우저 대상에는 v0.3을 선택하세요.",
      );
    const checked = checkSource(input);
    if (!checked.success) return checked;
    if (target === "browser" && checked.program.exports.length === 0)
      return compilationDiagnostic(
        "GE2005",
        input.path,
        "브라우저 모듈에는 공개 함수가 하나 이상 필요합니다.",
        "`공개 함수` 선언을 하나 이상 추가하세요.",
      );
    const sourceText = SourceFile.fromBytes(input.path, input.source).text;
    const generated = generateJavaScript(checked.program, {
      sourceText,
      ...(target === "browser" ? { target: "browser" as const } : {}),
    });
    return { success: true, ...generated, diagnostics: [], suppressedCount: 0 };
  } catch {
    return internalFailure();
  }
}
