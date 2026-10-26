import { describe, expect, it } from "vitest";
import { InvalidUtf8Error, SourceFile, positionAfterInvalidUtf8 } from "@geulion/ast";

describe("SourceFile", () => {
  it("preserves UTF-8 bytes and excludes only an initial BOM from text offsets", () => {
    const text = "가😀\r\n가\rX\n";
    const content = new TextEncoder().encode(text);
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...content]);
    const source = SourceFile.fromBytes("sample.geul", bytes);

    expect(source.path).toBe("sample.geul");
    expect(source.text).toBe(text);
    expect(source.hasBom).toBe(true);
    expect(source.originalBytes).toEqual(bytes);
    expect(source.positionAtCodePointOffset(0)).toEqual({
      byteOffset: 3,
      codePointOffset: 0,
      utf16Offset: 0,
      line: 1,
      column: 1,
    });
    expect(source.positionAtCodePointOffset(2)).toEqual({
      byteOffset: 10,
      codePointOffset: 2,
      utf16Offset: 3,
      line: 1,
      column: 4,
    });
    expect(source.positionAtUtf16Offset(3).codePointOffset).toBe(2);
    expect(source.positionAtByteOffset(10).utf16Offset).toBe(3);
    expect(source.positionAtCodePointOffset(4)).toMatchObject({ line: 2, column: 1 });
    expect(source.positionAtCodePointOffset(7)).toMatchObject({ line: 3, column: 1 });
    expect(source.positionAtCodePointOffset(9)).toMatchObject({ line: 4, column: 1 });
    expect(source.sourceLength).toEqual({
      byteOffset: bytes.length,
      codePointOffset: [...text].length,
      utf16Offset: text.length,
    });
    expect(source.lineStarts).toHaveLength(4);
  });

  it("uses UTF-16 code units for columns and rejects offsets inside a scalar", () => {
    const source = SourceFile.fromText("supplementary.geul", "a😀b");

    expect(source.positionAtCodePointOffset(2)).toMatchObject({ utf16Offset: 3, column: 4 });
    expect(source.positionAtUtf16Offset(3)).toMatchObject({ codePointOffset: 2, utf16Offset: 3 });
    expect(() => source.positionAtUtf16Offset(2)).toThrow(RangeError);
  });

  it.each([
    [new Uint8Array([0xc0, 0xaf]), 0],
    [new Uint8Array([0x61, 0xe2, 0x28, 0xa1]), 1],
    [new Uint8Array([0xf0, 0x9f]), 0],
    [new Uint8Array([0xed, 0xa0, 0x80]), 0],
  ])("rejects malformed UTF-8 without replacement decoding", (bytes, offset) => {
    try {
      SourceFile.fromBytes("invalid.geul", bytes);
      throw new Error("Expected invalid UTF-8 to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidUtf8Error);
      expect(error).toMatchObject({ byteOffset: offset });
      if (error instanceof InvalidUtf8Error) {
        expect(positionAfterInvalidUtf8(error).byteOffset).toBe(offset);
      }
    }
  });

  it("returns exact source lines", () => {
    const source = SourceFile.fromText("lines.geul", "first\r\nsecond\rthird\n");

    expect(source.lineText(1)).toBe("first");
    expect(source.lineText(2)).toBe("second");
    expect(source.lineText(3)).toBe("third");
    expect(source.lineText(4)).toBe("");
    expect(source.lineText(0)).toBeUndefined();
  });

  it("does not silently encode an unpaired UTF-16 surrogate", () => {
    expect(() => SourceFile.fromText("invalid-text.geul", "\ud800")).toThrow(RangeError);
  });
});
