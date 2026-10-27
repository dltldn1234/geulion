import {
  createDiagnostic,
  InvalidUtf8Error,
  positionAfterInvalidUtf8,
  SourceFile,
  type Diagnostic,
  type SourceSpan,
} from "@geulion/ast";
import {
  isControl,
  isIdentifierContinue,
  isIdentifierStart,
  isUnicodeWhiteSpace,
  normalizeIdentifier,
} from "./unicode.js";
import {
  TokenKind,
  type DelimiterTokenKind,
  type IdentifierToken,
  type KeywordTokenKind,
  type OperatorTokenKind,
  type Token,
  type TokenKind as TokenKindType,
} from "./token.js";

export interface LexSuccess {
  readonly success: true;
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly [];
  readonly suppressedCount: 0;
}

export interface LexFailure {
  readonly success: false;
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
  readonly suppressedCount: number;
}

export type LexResult = LexSuccess | LexFailure;

const keywords = new Map<string, KeywordTokenKind>([
  ["상수", TokenKind.Constant],
  ["변수", TokenKind.Variable],
  ["함수", TokenKind.Function],
  ["반환", TokenKind.Return],
  ["만약", TokenKind.If],
  ["아니면", TokenKind.Else],
  ["동안", TokenKind.While],
  ["중단", TokenKind.Break],
  ["계속", TokenKind.Continue],
  ["그리고", TokenKind.And],
  ["또는", TokenKind.Or],
  ["아니다", TokenKind.Not],
  ["참", TokenKind.True],
  ["거짓", TokenKind.False],
  ["정수", TokenKind.IntegerType],
  ["실수", TokenKind.RealType],
  ["문자열", TokenKind.StringType],
  ["불리언", TokenKind.BooleanType],
  ["없음", TokenKind.UnitType],
  ["목록", TokenKind.ListType],
  ["사전", TokenKind.DictionaryType],
  ["선택", TokenKind.OptionType],
  ["일부", TokenKind.Some],
  ["비어있음", TokenKind.None],
]);

const multiCharacterOperators = new Map<string, OperatorTokenKind>([
  ["->", TokenKind.Arrow],
  ["==", TokenKind.EqualEqual],
  ["!=", TokenKind.NotEqual],
  ["<=", TokenKind.LessEqual],
  [">=", TokenKind.GreaterEqual],
  ["??", TokenKind.Coalesce],
]);

const singleCharacterTokens = new Map<string, OperatorTokenKind | DelimiterTokenKind>([
  ["=", TokenKind.Assign],
  ["+", TokenKind.Plus],
  ["-", TokenKind.Minus],
  ["*", TokenKind.Star],
  ["/", TokenKind.Slash],
  ["%", TokenKind.Percent],
  ["<", TokenKind.Less],
  [">", TokenKind.Greater],
  ["(", TokenKind.LeftParen],
  [")", TokenKind.RightParen],
  ["[", TokenKind.LeftBracket],
  ["]", TokenKind.RightBracket],
  ["{", TokenKind.LeftBrace],
  ["}", TokenKind.RightBrace],
  [":", TokenKind.Colon],
  [",", TokenKind.Comma],
  [";", TokenKind.Semicolon],
]);

const simpleEscapes = new Map<string, string>([
  ["\\", "\\"],
  ['"', '"'],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["0", "\0"],
]);

function malformedUtf8Result(
  path: string,
  bytes: Uint8Array,
  firstError: InvalidUtf8Error,
): LexFailure {
  const diagnostics: Diagnostic[] = [];
  let suppressedCount = 0;
  let byteOffset = 0;
  let codePointOffset = 0;
  let utf16Offset = 0;
  let line = 1;
  let column = 1;
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (hasBom) byteOffset = 3;
  let index = byteOffset;

  const record = (errorOffset: number) => {
    const position = Object.freeze({
      byteOffset: errorOffset,
      codePointOffset,
      utf16Offset,
      line,
      column,
    });
    if (diagnostics.length < 100) {
      diagnostics.push(
        createDiagnostic({
          code: "GE0001",
          phase: "lex",
          message: "올바르지 않은 UTF-8 입력입니다.",
          path,
          range: Object.freeze({ start: position, end: position }),
          help: "소스 파일을 유효한 UTF-8로 다시 저장하세요.",
        }),
      );
    } else {
      suppressedCount += 1;
    }
  };

  while (index < bytes.length) {
    const first = bytes[index];
    if (first === undefined) break;
    let width = 0;
    let valid = true;
    if (first <= 0x7f) width = 1;
    else if (first >= 0xc2 && first <= 0xdf) width = 2;
    else if (first >= 0xe0 && first <= 0xef) width = 3;
    else if (first >= 0xf0 && first <= 0xf4) width = 4;
    else valid = false;

    if (valid) {
      for (let part = 1; part < width; part += 1) {
        const byte = bytes[index + part];
        if (byte === undefined || byte < 0x80 || byte > 0xbf) {
          valid = false;
          width = part;
          break;
        }
        if (
          part === 1 &&
          ((first === 0xe0 && byte < 0xa0) ||
            (first === 0xed && byte > 0x9f) ||
            (first === 0xf0 && byte < 0x90) ||
            (first === 0xf4 && byte > 0x8f))
        ) {
          valid = false;
          width = 1;
          break;
        }
      }
      if (valid) {
        const second = bytes[index + 1] ?? 0;
        const third = bytes[index + 2] ?? 0;
        const fourth = bytes[index + 3] ?? 0;
        const point =
          width === 1
            ? first
            : width === 2
              ? ((first & 0x1f) << 6) | (second & 0x3f)
              : width === 3
                ? ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f)
                : ((first & 0x07) << 18) |
                  ((second & 0x3f) << 12) |
                  ((third & 0x3f) << 6) |
                  (fourth & 0x3f);
        if (point === 0x0d && bytes[index + width] === 0x0a) {
          byteOffset += width;
          codePointOffset += 1;
          utf16Offset += 1;
          column += 1;
        } else if (point === 0x0a || point === 0x0d) {
          line += 1;
          column = 1;
          byteOffset += width;
          codePointOffset += 1;
          utf16Offset += 1;
        } else {
          const utf16Width = point > 0xffff ? 2 : 1;
          byteOffset += width;
          codePointOffset += 1;
          utf16Offset += utf16Width;
          column += utf16Width;
        }
        index += width;
        continue;
      }
    }

    record(index);
    const invalidWidth = Math.max(width, 1);
    index += invalidWidth;
    byteOffset += invalidWidth;
    codePointOffset += 1;
    utf16Offset += 1;
    column += 1;
  }

  if (diagnostics.length === 0) {
    const position = positionAfterInvalidUtf8(firstError);
    diagnostics.push(
      createDiagnostic({
        code: "GE0001",
        phase: "lex",
        message: "올바르지 않은 UTF-8 입력입니다.",
        path,
        range: Object.freeze({ start: position, end: position }),
        help: "소스 파일을 유효한 UTF-8로 다시 저장하세요.",
      }),
    );
  }
  return { success: false, tokens: [], diagnostics: Object.freeze(diagnostics), suppressedCount };
}

function isAsciiDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isHexDigit(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= "0" && character <= "9") ||
      (character >= "a" && character <= "f") ||
      (character >= "A" && character <= "F"))
  );
}

export function lex(source: SourceFile): LexResult {
  const characters = [...source.text];
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let suppressedCount = 0;
  let current = 0;

  const textAt = (index: number, length = 1) => characters.slice(index, index + length).join("");
  const pointAt = (index: number) => characters[index]?.codePointAt(0);
  const span = (start: number, end: number): SourceSpan => source.span(start, end);
  const emit = (
    kind: TokenKindType,
    start: number,
    end: number,
    fields: Record<string, unknown> = {},
  ) => {
    tokens.push({
      kind,
      rawLexeme: textAt(start, end - start),
      span: span(start, end),
      ...fields,
    } as Token);
  };
  const report = (
    code: "GE0001" | "GE0002" | "GE0003",
    message: string,
    help: string,
    start: number,
    end: number,
  ) => {
    if (diagnostics.length < 100) {
      diagnostics.push(
        createDiagnostic({
          code,
          phase: "lex",
          message,
          path: source.path,
          range: span(start, end),
          help,
        }),
      );
    } else {
      suppressedCount += 1;
    }
  };

  while (current < characters.length) {
    const character = characters[current];
    const point = pointAt(current);
    if (character === undefined || point === undefined) break;

    if (character === " " || character === "\t") {
      current += 1;
      continue;
    }

    if (character === "\r" || character === "\n") {
      const start = current;
      if (character === "\r" && characters[current + 1] === "\n") current += 2;
      else current += 1;
      emit(TokenKind.Newline, start, current);
      continue;
    }

    if (character === "/" && characters[current + 1] === "/") {
      current += 2;
      while (
        current < characters.length &&
        characters[current] !== "\r" &&
        characters[current] !== "\n"
      ) {
        current += 1;
      }
      continue;
    }

    if (character === "/" && characters[current + 1] === "*") {
      const start = current;
      current += 2;
      let closed = false;
      while (current < characters.length) {
        if (characters[current] === "*" && characters[current + 1] === "/") {
          current += 2;
          closed = true;
          break;
        }
        if (characters[current] === "\r" || characters[current] === "\n") {
          const lineStart = current;
          if (characters[current] === "\r" && characters[current + 1] === "\n") current += 2;
          else current += 1;
          emit(TokenKind.Newline, lineStart, current);
          continue;
        }
        current += 1;
      }
      if (!closed) {
        report(
          "GE0003",
          "블록 주석이 닫히지 않았습니다.",
          "주석을 `*/`로 닫으세요.",
          start,
          current,
        );
      }
      continue;
    }

    if (character === '"') {
      const start = current;
      current += 1;
      let value = "";
      let malformed = false;
      let closed = false;
      while (current < characters.length) {
        const next = characters[current];
        if (next === undefined) break;
        if (next === '"') {
          current += 1;
          closed = true;
          break;
        }
        if (next === "\r" || next === "\n") break;
        const nextPoint = pointAt(current);
        if (nextPoint !== undefined && nextPoint <= 0x1f) {
          malformed = true;
          current += 1;
          continue;
        }
        if (next !== "\\") {
          value += next;
          current += 1;
          continue;
        }

        const escapeStart = current;
        current += 1;
        const escape = characters[current];
        if (escape === undefined) {
          malformed = true;
          break;
        }
        const simple = simpleEscapes.get(escape);
        if (simple !== undefined) {
          value += simple;
          current += 1;
          continue;
        }
        if (escape !== "u" || characters[current + 1] !== "{") {
          malformed = true;
          current += 1;
          continue;
        }

        current += 2;
        let hex = "";
        let invalidHex = false;
        while (
          current < characters.length &&
          characters[current] !== "}" &&
          characters[current] !== '"' &&
          characters[current] !== "\r" &&
          characters[current] !== "\n"
        ) {
          const digit = characters[current];
          if (isHexDigit(digit)) hex += digit;
          else invalidHex = true;
          current += 1;
        }
        if (characters[current] === "}") current += 1;
        const scalar = hex.length > 0 && hex.length <= 6 ? Number.parseInt(hex, 16) : -1;
        if (
          invalidHex ||
          scalar < 0 ||
          scalar > 0x10ffff ||
          (scalar >= 0xd800 && scalar <= 0xdfff) ||
          characters[current - 1] !== "}"
        ) {
          malformed = true;
          if (current === escapeStart + 1) current += 1;
        } else {
          value += String.fromCodePoint(scalar);
        }
        if (characters[current] === '"') {
          current += 1;
          closed = true;
          break;
        }
      }

      if (!closed || malformed) {
        const end = current;
        if (!closed && (characters[current] === "\r" || characters[current] === "\n")) {
          // Leave the line break to the normal newline scanner.
        }
        report(
          "GE0002",
          closed
            ? "문자열에 잘못된 문자 또는 escape가 있습니다."
            : "문자열 리터럴이 닫히지 않았습니다.",
          '문자열을 닫고 escape를 `\\`, `\\"`, `\\n`, `\\r`, `\\t`, `\\0`, `\\u{...}` 중 하나로 고치세요.',
          start,
          end,
        );
      } else {
        emit(TokenKind.StringLiteral, start, current, { value });
      }
      continue;
    }

    if (isAsciiDigit(character)) {
      const start = current;
      while (isAsciiDigit(characters[current])) current += 1;
      let kind: typeof TokenKind.IntegerLiteral | typeof TokenKind.RealLiteral =
        TokenKind.IntegerLiteral;
      let malformed = false;

      if (characters[current] === ".") {
        current += 1;
        if (!isAsciiDigit(characters[current])) malformed = true;
        else {
          kind = TokenKind.RealLiteral;
          while (isAsciiDigit(characters[current])) current += 1;
        }
      }

      if (characters[current] === "e" || characters[current] === "E") {
        kind = TokenKind.RealLiteral;
        current += 1;
        if (characters[current] === "+" || characters[current] === "-") current += 1;
        const exponentStart = current;
        while (isAsciiDigit(characters[current])) current += 1;
        if (current === exponentStart) malformed = true;
      }

      if (isIdentifierContinue(pointAt(current) ?? -1)) {
        malformed = true;
        while (isIdentifierContinue(pointAt(current) ?? -1)) current += 1;
      }

      if (malformed) {
        report(
          "GE0002",
          "숫자 리터럴 형식이 잘못되었습니다.",
          "정수는 10진 숫자로, 실수는 숫자.숫자 또는 유효한 지수 표기로 작성하세요.",
          start,
          current,
        );
      } else {
        emit(kind, start, current);
      }
      continue;
    }

    if (isIdentifierStart(point)) {
      const start = current;
      current += 1;
      while (isIdentifierContinue(pointAt(current) ?? -1)) current += 1;
      const rawLexeme = textAt(start, current - start);
      const normalizedName = normalizeIdentifier(rawLexeme);
      const keywordKind = keywords.get(normalizedName);
      if (keywordKind !== undefined) emit(keywordKind, start, current);
      else {
        const token: IdentifierToken = {
          kind: TokenKind.Identifier,
          rawLexeme,
          normalizedName,
          span: span(start, current),
        };
        tokens.push(token);
      }
      continue;
    }

    const operatorText = textAt(current, 2);
    const operatorKind = multiCharacterOperators.get(operatorText);
    if (operatorKind !== undefined) {
      emit(operatorKind, current, current + 2);
      current += 2;
      continue;
    }

    const singleKind = singleCharacterTokens.get(character);
    if (singleKind !== undefined) {
      emit(singleKind, current, current + 1);
      current += 1;
      continue;
    }

    if (isUnicodeWhiteSpace(point) || isControl(point) || point === 0xfeff) {
      report(
        "GE0001",
        "허용되지 않는 공백 또는 제어 문자가 있습니다.",
        "공백은 ASCII space 또는 tab을 사용하고 줄바꿈은 LF, CRLF, CR로 작성하세요.",
        current,
        current + 1,
      );
    } else {
      report(
        "GE0001",
        `허용되지 않는 문자 U+${point
          .toString(16)
          .toUpperCase()
          .padStart(point <= 0xffff ? 4 : 6, "0")}입니다.`,
        "GEULION v0.1에 정의된 식별자, literal, 연산자 또는 구분자를 사용하세요.",
        current,
        current + 1,
      );
    }
    current += 1;
  }

  const eofPosition = source.positionAtCodePointOffset(characters.length);
  const eofSpan = Object.freeze({ start: eofPosition, end: eofPosition });
  tokens.push({ kind: TokenKind.EndOfFile, rawLexeme: "", span: eofSpan });
  const frozenTokens = Object.freeze(tokens);
  if (diagnostics.length > 0 || suppressedCount > 0) {
    return {
      success: false,
      tokens: frozenTokens,
      diagnostics: Object.freeze(diagnostics),
      suppressedCount,
    };
  }
  return { success: true, tokens: frozenTokens, diagnostics: [], suppressedCount: 0 };
}

export function lexBytes(path: string, bytes: Uint8Array): LexResult {
  try {
    return lex(SourceFile.fromBytes(path, bytes));
  } catch (error) {
    if (error instanceof InvalidUtf8Error) return malformedUtf8Result(path, bytes, error);
    throw error;
  }
}
