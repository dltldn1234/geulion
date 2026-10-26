import type { SourceSpan } from "@geulion/ast";

export const TokenKind = {
  Identifier: "Identifier",
  IntegerLiteral: "IntegerLiteral",
  RealLiteral: "RealLiteral",
  StringLiteral: "StringLiteral",
  Constant: "상수",
  Variable: "변수",
  Function: "함수",
  Return: "반환",
  If: "만약",
  Else: "아니면",
  While: "동안",
  Break: "중단",
  Continue: "계속",
  And: "그리고",
  Or: "또는",
  Not: "아니다",
  True: "참",
  False: "거짓",
  IntegerType: "정수",
  RealType: "실수",
  StringType: "문자열",
  BooleanType: "불리언",
  UnitType: "없음",
  ListType: "목록",
  DictionaryType: "사전",
  OptionType: "선택",
  Some: "일부",
  None: "비어있음",
  Arrow: "->",
  EqualEqual: "==",
  NotEqual: "!=",
  LessEqual: "<=",
  GreaterEqual: ">=",
  Coalesce: "??",
  Assign: "=",
  Plus: "+",
  Minus: "-",
  Star: "*",
  Slash: "/",
  Percent: "%",
  Less: "<",
  Greater: ">",
  LeftParen: "(",
  RightParen: ")",
  LeftBracket: "[",
  RightBracket: "]",
  LeftBrace: "{",
  RightBrace: "}",
  Colon: ":",
  Comma: ",",
  Semicolon: ";",
  Newline: "Newline",
  EndOfFile: "EndOfFile",
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

export interface TokenBase {
  readonly rawLexeme: string;
  readonly span: SourceSpan;
}

export interface IdentifierToken extends TokenBase {
  readonly kind: typeof TokenKind.Identifier;
  readonly normalizedName: string;
}

export interface IntegerLiteralToken extends TokenBase {
  readonly kind: typeof TokenKind.IntegerLiteral;
}

export interface RealLiteralToken extends TokenBase {
  readonly kind: typeof TokenKind.RealLiteral;
}

export interface StringLiteralToken extends TokenBase {
  readonly kind: typeof TokenKind.StringLiteral;
  readonly value: string;
}

export type KeywordTokenKind =
  | typeof TokenKind.Constant
  | typeof TokenKind.Variable
  | typeof TokenKind.Function
  | typeof TokenKind.Return
  | typeof TokenKind.If
  | typeof TokenKind.Else
  | typeof TokenKind.While
  | typeof TokenKind.Break
  | typeof TokenKind.Continue
  | typeof TokenKind.And
  | typeof TokenKind.Or
  | typeof TokenKind.Not
  | typeof TokenKind.True
  | typeof TokenKind.False
  | typeof TokenKind.IntegerType
  | typeof TokenKind.RealType
  | typeof TokenKind.StringType
  | typeof TokenKind.BooleanType
  | typeof TokenKind.UnitType
  | typeof TokenKind.ListType
  | typeof TokenKind.DictionaryType
  | typeof TokenKind.OptionType
  | typeof TokenKind.Some
  | typeof TokenKind.None;

export type OperatorTokenKind =
  | typeof TokenKind.Arrow
  | typeof TokenKind.EqualEqual
  | typeof TokenKind.NotEqual
  | typeof TokenKind.LessEqual
  | typeof TokenKind.GreaterEqual
  | typeof TokenKind.Coalesce
  | typeof TokenKind.Assign
  | typeof TokenKind.Plus
  | typeof TokenKind.Minus
  | typeof TokenKind.Star
  | typeof TokenKind.Slash
  | typeof TokenKind.Percent
  | typeof TokenKind.Less
  | typeof TokenKind.Greater;

export type DelimiterTokenKind =
  | typeof TokenKind.LeftParen
  | typeof TokenKind.RightParen
  | typeof TokenKind.LeftBracket
  | typeof TokenKind.RightBracket
  | typeof TokenKind.LeftBrace
  | typeof TokenKind.RightBrace
  | typeof TokenKind.Colon
  | typeof TokenKind.Comma
  | typeof TokenKind.Semicolon;

export interface KeywordToken extends TokenBase {
  readonly kind: KeywordTokenKind;
}

export interface OperatorToken extends TokenBase {
  readonly kind: OperatorTokenKind;
}

export interface DelimiterToken extends TokenBase {
  readonly kind: DelimiterTokenKind;
}

export interface NewlineToken extends TokenBase {
  readonly kind: typeof TokenKind.Newline;
}

export interface EndOfFileToken extends TokenBase {
  readonly kind: typeof TokenKind.EndOfFile;
}

export type Token =
  | IdentifierToken
  | IntegerLiteralToken
  | RealLiteralToken
  | StringLiteralToken
  | KeywordToken
  | OperatorToken
  | DelimiterToken
  | NewlineToken
  | EndOfFileToken;
