import { TextDecoder, TextEncoder } from "node:util";

export interface SourcePosition {
  readonly byteOffset: number;
  readonly codePointOffset: number;
  readonly utf16Offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface SourceLength {
  readonly byteOffset: number;
  readonly codePointOffset: number;
  readonly utf16Offset: number;
}

export class InvalidUtf8Error extends Error {
  override readonly name = "InvalidUtf8Error";

  constructor(
    readonly path: string,
    readonly byteOffset: number,
    readonly validPrefix: Uint8Array,
  ) {
    super(`Invalid UTF-8 at byte offset ${byteOffset}`);
  }
}

function isContinuation(byte: number | undefined): byte is number {
  return byte !== undefined && byte >= 0x80 && byte <= 0xbf;
}

function invalidUtf8Offset(bytes: Uint8Array): number | undefined {
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    if (first === undefined) return undefined;
    if (first <= 0x7f) {
      index += 1;
      continue;
    }

    if (first >= 0xc2 && first <= 0xdf) {
      if (!isContinuation(bytes[index + 1])) return index;
      index += 2;
      continue;
    }

    if (first >= 0xe0 && first <= 0xef) {
      const second = bytes[index + 1];
      const validSecond =
        second !== undefined &&
        (first === 0xe0
          ? second >= 0xa0 && second <= 0xbf
          : first === 0xed
            ? second >= 0x80 && second <= 0x9f
            : isContinuation(second));
      if (!validSecond || !isContinuation(bytes[index + 2])) return index;
      index += 3;
      continue;
    }

    if (first >= 0xf0 && first <= 0xf4) {
      const second = bytes[index + 1];
      const validSecond =
        second !== undefined &&
        (first === 0xf0
          ? second >= 0x90 && second <= 0xbf
          : first === 0xf4
            ? second >= 0x80 && second <= 0x8f
            : isContinuation(second));
      if (!validSecond || !isContinuation(bytes[index + 2]) || !isContinuation(bytes[index + 3])) {
        return index;
      }
      index += 4;
      continue;
    }

    return index;
  }
  return undefined;
}

function makePosition(
  byteOffset: number,
  codePointOffset: number,
  utf16Offset: number,
  line: number,
  column: number,
): SourcePosition {
  return Object.freeze({ byteOffset, codePointOffset, utf16Offset, line, column });
}

/** A lossless UTF-8 source file with position indexes at Unicode scalar boundaries. */
export class SourceFile {
  readonly path: string;
  readonly text: string;
  readonly hasBom: boolean;
  readonly sourceLength: SourceLength;
  readonly lineStarts: readonly SourcePosition[];
  readonly #bytes: Uint8Array;
  readonly #positionsByByte = new Map<number, SourcePosition>();
  readonly #positionsByCodePoint = new Map<number, SourcePosition>();
  readonly #positionsByUtf16 = new Map<number, SourcePosition>();

  private constructor(path: string, bytes: Uint8Array, text: string, hasBom: boolean) {
    this.path = path;
    this.#bytes = bytes;
    this.text = text;
    this.hasBom = hasBom;

    let byteOffset = hasBom ? 3 : 0;
    let codePointOffset = 0;
    let utf16Offset = 0;
    let line = 1;
    let column = 1;
    const lineStarts: SourcePosition[] = [];
    const initial = makePosition(byteOffset, codePointOffset, utf16Offset, line, column);
    lineStarts.push(initial);

    const characters = [...text];
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index];
      if (character === undefined) continue;
      const point = character.codePointAt(0);
      if (point === undefined) continue;
      const start = makePosition(byteOffset, codePointOffset, utf16Offset, line, column);
      this.#positionsByByte.set(byteOffset, start);
      this.#positionsByCodePoint.set(codePointOffset, start);
      this.#positionsByUtf16.set(utf16Offset, start);

      byteOffset += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      codePointOffset += 1;
      const utf16Width = point > 0xffff ? 2 : 1;
      utf16Offset += utf16Width;

      if (character === "\r" && characters[index + 1] === "\n") {
        column += utf16Width;
      } else if (character === "\r" || character === "\n") {
        line += 1;
        column = 1;
        lineStarts.push(makePosition(byteOffset, codePointOffset, utf16Offset, line, column));
      } else {
        column += utf16Width;
      }
    }

    const end = makePosition(byteOffset, codePointOffset, utf16Offset, line, column);
    this.#positionsByByte.set(byteOffset, end);
    this.#positionsByCodePoint.set(codePointOffset, end);
    this.#positionsByUtf16.set(utf16Offset, end);
    this.sourceLength = Object.freeze({ byteOffset, codePointOffset, utf16Offset });
    this.lineStarts = Object.freeze(lineStarts);
    Object.freeze(this);
  }

  static fromBytes(path: string, input: Uint8Array): SourceFile {
    const bytes = input.slice();
    const invalidOffset = invalidUtf8Offset(bytes);
    if (invalidOffset !== undefined) {
      throw new InvalidUtf8Error(path, invalidOffset, bytes.slice(0, invalidOffset));
    }

    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const textBytes = hasBom ? bytes.subarray(3) : bytes;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(textBytes);
    return new SourceFile(path, bytes, text, hasBom);
  }

  static fromText(path: string, text: string): SourceFile {
    for (const character of text) {
      const point = character.codePointAt(0);
      if (point !== undefined && point >= 0xd800 && point <= 0xdfff) {
        throw new RangeError("Source text must contain Unicode scalar values");
      }
    }
    return SourceFile.fromBytes(path, new TextEncoder().encode(text));
  }

  /** Returns a defensive copy of the original bytes, including a leading BOM. */
  get originalBytes(): Uint8Array {
    return this.#bytes.slice();
  }

  positionAtByteOffset(offset: number): SourcePosition {
    return this.#lookup(this.#positionsByByte, offset, "byte");
  }

  positionAtCodePointOffset(offset: number): SourcePosition {
    return this.#lookup(this.#positionsByCodePoint, offset, "code point");
  }

  positionAtUtf16Offset(offset: number): SourcePosition {
    return this.#lookup(this.#positionsByUtf16, offset, "UTF-16");
  }

  span(startCodePointOffset: number, endCodePointOffset: number): SourceSpan {
    if (endCodePointOffset < startCodePointOffset) {
      throw new RangeError("Source span end must not precede its start");
    }
    return Object.freeze({
      start: this.positionAtCodePointOffset(startCodePointOffset),
      end: this.positionAtCodePointOffset(endCodePointOffset),
    });
  }

  lineText(line: number): string | undefined {
    if (!Number.isInteger(line) || line < 1 || line > this.lineStarts.length) return undefined;
    const lines = this.text.split(/\r\n|\r|\n/u);
    return lines[line - 1];
  }

  #lookup(
    index: ReadonlyMap<number, SourcePosition>,
    offset: number,
    unit: string,
  ): SourcePosition {
    const position = index.get(offset);
    if (position === undefined)
      throw new RangeError(`${unit} offset ${offset} is not a source boundary`);
    return position;
  }
}

export function positionAfterInvalidUtf8(error: InvalidUtf8Error): SourcePosition {
  return SourceFile.fromBytes(error.path, error.validPrefix).positionAtByteOffset(error.byteOffset);
}
