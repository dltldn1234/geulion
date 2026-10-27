import type { Diagnostic } from "@geulion/ast";

const phaseNames = {
  lex: "어휘 분석",
  parse: "구문 분석",
  resolve: "이름 해석",
  type: "타입 검사",
  runtime: "실행",
  internal: "내부 오류",
} as const;

export function renderDiagnostics(
  diagnostics: readonly Diagnostic[],
  sourceText?: string,
  suppressedCount = 0,
): string {
  const sourceLines = sourceText?.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const output: string[] = [];
  function snippet(range: NonNullable<Diagnostic["range"]>) {
    const { start, end } = range;
    const sourceLine = sourceLines?.[start.line - 1];
    if (sourceLine !== undefined) {
      const width = Math.max(
        1,
        end.line === start.line ? end.column - start.column : sourceLine.length - start.column + 2,
      );
      const prefix = sourceLine.slice(0, start.column - 1).replace(/[^\t]/g, " ");
      output.push(sourceLine, `${prefix}${"^".repeat(width)}`);
    }
  }
  for (const diagnostic of diagnostics) {
    output.push(`오류 [${diagnostic.code}] ${phaseNames[diagnostic.phase]}: ${diagnostic.message}`);
    if (diagnostic.path !== null && diagnostic.range !== null) {
      const { start } = diagnostic.range;
      output.push(`  ${diagnostic.path}:${start.line}:${start.column}`);
      snippet(diagnostic.range);
    }
    if (diagnostic.help !== null) output.push(`도움말: ${diagnostic.help}`);
    for (const related of diagnostic.related) {
      const location =
        related.path !== null && related.range !== null
          ? ` ${related.path}:${related.range.start.line}:${related.range.start.column}`
          : "";
      output.push(`관련: ${related.message}${location}`);
      if (related.path === diagnostic.path && related.range !== null) snippet(related.range);
    }
  }
  if (diagnostics.length >= 100 || suppressedCount > 0) {
    output.push(
      `안내: 진단은 최대 100개까지 표시합니다. 추가 오류는 억제됩니다.${suppressedCount > 0 ? ` (억제 ${suppressedCount}개)` : ""}`,
    );
  }
  return output.length === 0 ? "" : `${output.join("\n")}\n`;
}
