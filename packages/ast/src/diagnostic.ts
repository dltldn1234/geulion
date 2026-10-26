import type { SourceSpan } from "./source.js";

export type DiagnosticPhase = "lex" | "parse" | "resolve" | "type" | "runtime" | "internal";

export type DiagnosticCode =
  | "GE0001"
  | "GE0002"
  | "GE0003"
  | "GE1001"
  | "GE1002"
  | "GE2001"
  | "GE2002"
  | "GE2003"
  | "GE3001"
  | "GE3002"
  | "GE3003"
  | "GE3004"
  | "GE3005"
  | "GE3006"
  | "GE3007"
  | "GE3008"
  | "GE4001"
  | "GE4002"
  | "GE4003"
  | "GE4004"
  | "GE9001";

export interface RelatedDiagnosticInformation {
  readonly message: string;
  readonly path: string | null;
  readonly range: SourceSpan | null;
}

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly phase: DiagnosticPhase;
  readonly severity: "error";
  readonly message: string;
  readonly path: string | null;
  readonly range: SourceSpan | null;
  readonly help: string | null;
  readonly related: readonly RelatedDiagnosticInformation[];
}

export function createDiagnostic(
  fields: Omit<Diagnostic, "severity" | "related"> & {
    readonly related?: readonly RelatedDiagnosticInformation[];
  },
): Diagnostic {
  return Object.freeze({
    ...fields,
    severity: "error",
    related: Object.freeze([...(fields.related ?? [])]),
  });
}
