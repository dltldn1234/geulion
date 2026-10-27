import type { Diagnostic } from "@geulion/ast";

export function limitDiagnostics(diagnostics: readonly Diagnostic[], suppressed = 0) {
  const ordered = [...diagnostics].sort(
    (a, b) => (a.range?.start.byteOffset ?? 0) - (b.range?.start.byteOffset ?? 0),
  );
  return {
    diagnostics: ordered.slice(0, 100),
    suppressedCount: suppressed + Math.max(0, ordered.length - 100),
  };
}
