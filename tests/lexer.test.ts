import { describe, expect, it } from "vitest";
import { SourceFile } from "@geulion/ast";
import { lex, lexBytes } from "@geulion/lexer";
import { TokenKind } from "@geulion/lexer";

function lexText(text: string) {
  return lex(SourceFile.fromText("test.geul", text));
}

describe("GEULION lexer", () => {
  it("classifies the complete reserved keyword set and leaves prelude names as identifiers", () => {
    const result = lexText(
      "상수 변수 함수 반환 만약 아니면 동안 중단 계속 그리고 또는 아니다 참 거짓 정수 실수 문자열 불리언 없음 목록 사전 선택 일부 비어있음 시작 출력 정수로 실수로",
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.tokens.map((token) => token.kind)).toEqual([
      TokenKind.Constant,
      TokenKind.Variable,
      TokenKind.Function,
      TokenKind.Return,
      TokenKind.If,
      TokenKind.Else,
      TokenKind.While,
      TokenKind.Break,
      TokenKind.Continue,
      TokenKind.And,
      TokenKind.Or,
      TokenKind.Not,
      TokenKind.True,
      TokenKind.False,
      TokenKind.IntegerType,
      TokenKind.RealType,
      TokenKind.StringType,
      TokenKind.BooleanType,
      TokenKind.UnitType,
      TokenKind.ListType,
      TokenKind.DictionaryType,
      TokenKind.OptionType,
      TokenKind.Some,
      TokenKind.None,
      TokenKind.Identifier,
      TokenKind.Identifier,
      TokenKind.Identifier,
      TokenKind.Identifier,
      TokenKind.EndOfFile,
    ]);
    expect(result.tokens.slice(24, 28).map((token) => token.rawLexeme)).toEqual([
      "시작",
      "출력",
      "정수로",
      "실수로",
    ]);
  });

  it("normalizes keyword spellings and preserves identifier raw spelling", () => {
    const result = lexText("함수 함수이름 가 가");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.tokens[0]).toMatchObject({ kind: TokenKind.Function, rawLexeme: "함수" });
    expect(result.tokens[1]).toMatchObject({
      kind: TokenKind.Identifier,
      rawLexeme: "함수이름",
      normalizedName: "함수이름",
    });
    expect(result.tokens[2]).toMatchObject({
      kind: TokenKind.Identifier,
      rawLexeme: "가",
      normalizedName: "가",
    });
    expect(result.tokens[3]).toMatchObject({
      kind: TokenKind.Identifier,
      rawLexeme: "가",
      normalizedName: "가",
    });
  });

  it("accepts Unicode 18 identifiers and rejects excluded code points", () => {
    const accepted = lexText(`${String.fromCodePoint(0x0558)}이름 _x name2`);
    expect(accepted.success).toBe(true);
    if (accepted.success) {
      expect(accepted.tokens.slice(0, 3).map((token) => token.kind)).toEqual([
        TokenKind.Identifier,
        TokenKind.Identifier,
        TokenKind.Identifier,
      ]);
    }

    const rejected = lexText(`a\u034f b\u202e`);
    expect(rejected.success).toBe(false);
    expect(rejected.diagnostics.map(({ code }) => code)).toEqual(["GE0001", "GE0001"]);

    const nonAsciiSpace = lexText("a\u00a0b");
    expect(nonAsciiSpace.success).toBe(false);
    expect(nonAsciiSpace.diagnostics[0]?.code).toBe("GE0001");
  });

  it("recognizes numeric forms and reports malformed numeric candidates as one error", () => {
    const valid = lexText("123 1.25 1e2 2.3E-4");
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.tokens.map((token) => token.kind)).toEqual([
        TokenKind.IntegerLiteral,
        TokenKind.RealLiteral,
        TokenKind.RealLiteral,
        TokenKind.RealLiteral,
        TokenKind.EndOfFile,
      ]);
    }

    const invalid = lexText("1e 12이름 1.");
    expect(invalid.success).toBe(false);
    expect(invalid.diagnostics.map(({ code }) => code)).toEqual(["GE0002", "GE0002", "GE0002"]);
  });

  it("decodes only the specified string escapes and rejects invalid scalars", () => {
    const valid = lexText(String.raw`"글리온\n\r\t\0\\\"\u{1F600}"`);
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.tokens[0]).toMatchObject({
        kind: TokenKind.StringLiteral,
        value: '글리온\n\r\t\0\\"😀',
      });
    }

    const c1Control = lexText(`"${String.fromCodePoint(0x85)}"`);
    expect(c1Control.success).toBe(true);

    for (const text of [
      '"\\q"',
      '"\\u{}"',
      '"\\u{D800}"',
      '"\\u{110000}"',
      '"raw\u0001control"',
      '"unterminated',
    ]) {
      const result = lexText(text);
      expect(result.success, text).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("GE0002");
    }
  });

  it("uses longest-match operators and emits logical line tokens", () => {
    const result = lexText(
      "-> == != <= >= ?? = + - * / % < >\n/* block\r\ncomment */ // line\rname",
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.tokens.slice(0, 14).map((token) => token.kind)).toEqual([
      TokenKind.Arrow,
      TokenKind.EqualEqual,
      TokenKind.NotEqual,
      TokenKind.LessEqual,
      TokenKind.GreaterEqual,
      TokenKind.Coalesce,
      TokenKind.Assign,
      TokenKind.Plus,
      TokenKind.Minus,
      TokenKind.Star,
      TokenKind.Slash,
      TokenKind.Percent,
      TokenKind.Less,
      TokenKind.Greater,
    ]);
    expect(result.tokens.filter(({ kind }) => kind === TokenKind.Newline)).toHaveLength(3);
    expect(result.tokens.at(-2)).toMatchObject({ kind: TokenKind.Identifier, rawLexeme: "name" });
  });

  it("does not nest block comments and preserves comment line breaks", () => {
    const result = lexText("/* outer\n/* nested */ x */");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.tokens.map(({ kind }) => kind)).toEqual([
        TokenKind.Newline,
        TokenKind.Identifier,
        TokenKind.Star,
        TokenKind.Slash,
        TokenKind.EndOfFile,
      ]);
    }

    const unclosed = lexText("/* never closed");
    expect(unclosed.success).toBe(false);
    expect(unclosed.diagnostics[0]).toMatchObject({ code: "GE0003", phase: "lex" });
  });

  it("reports invalid UTF-8 byte sequences with original offsets and blocks token output", () => {
    const bytes = new Uint8Array([0x61, 0xff, 0x62, 0xfe]);
    const result = lexBytes("bad-bytes.geul", bytes);
    expect(result.success).toBe(false);
    expect(result.tokens).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["GE0001", "GE0001"]);
    expect(result.diagnostics.map(({ range }) => range?.start.byteOffset)).toEqual([1, 3]);

    const bomResult = lexBytes("bad-bom.geul", new Uint8Array([0xef, 0xbb, 0xbf, 0xff]));
    expect(bomResult.diagnostics[0]?.range?.start).toMatchObject({
      byteOffset: 3,
      codePointOffset: 0,
    });
  });

  it("caps source-ordered lexical diagnostics and reports the suppression count", () => {
    const result = lexText("😀".repeat(105));
    expect(result.success).toBe(false);
    expect(result.diagnostics).toHaveLength(100);
    expect(result.suppressedCount).toBe(5);
    expect(result.diagnostics[0]?.range?.start.codePointOffset).toBe(0);
    expect(result.diagnostics[99]?.range?.start.codePointOffset).toBe(99);
  });

  it("produces a zero-width EOF span and accounts for BOM and multibyte text", () => {
    const input = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("함수 시작()\r\n"),
    ]);
    const result = lex(SourceFile.fromBytes("bom.geul", input));
    expect(result.success).toBe(true);
    if (result.success) {
      const eof = result.tokens.at(-1);
      expect(eof).toMatchObject({
        kind: TokenKind.EndOfFile,
        span: { start: { byteOffset: input.length, codePointOffset: 9, line: 2, column: 1 } },
      });
    }
  });
});
