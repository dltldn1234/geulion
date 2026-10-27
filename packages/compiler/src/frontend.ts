import type { Diagnostic, ProgramNode } from "@geulion/ast";
import { lexBytes, type LexResult, type Token } from "@geulion/lexer";
import { parseTokens } from "@geulion/parser";

export interface ParseSourceSuccess {
  readonly success: true;
  readonly tokens: readonly Token[];
  readonly ast: ProgramNode;
  readonly diagnostics: readonly [];
  readonly suppressedCount: 0;
}

export interface ParseSourceFailure {
  readonly success: false;
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
  readonly suppressedCount: number;
}

export type ParseSourceResult = ParseSourceSuccess | ParseSourceFailure;

export function tokenizeSource(input: {
  readonly path: string;
  readonly source: Uint8Array;
}): LexResult {
  return lexBytes(input.path, input.source);
}

export function parseSource(input: {
  readonly path: string;
  readonly source: Uint8Array;
}): ParseSourceResult {
  const lexical = tokenizeSource(input);
  if (!lexical.success) {
    return {
      success: false,
      tokens: lexical.tokens,
      diagnostics: lexical.diagnostics,
      suppressedCount: lexical.suppressedCount,
    };
  }

  const parsed = parseTokens(lexical.tokens, input.path);
  if (!parsed.success) {
    return {
      success: false,
      tokens: lexical.tokens,
      diagnostics: parsed.diagnostics,
      suppressedCount: 0,
    };
  }

  return {
    success: true,
    tokens: lexical.tokens,
    ast: parsed.ast,
    diagnostics: [],
    suppressedCount: 0,
  };
}
