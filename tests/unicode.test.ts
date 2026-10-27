import { describe, expect, it } from "vitest";
import {
  isBidiControl,
  isDefaultIgnorable,
  isIdentifierContinue,
  isIdentifierStart,
  isUnicodeWhiteSpace,
  normalizeIdentifier,
  normalizeNfc,
  UNICODE_VERSION,
} from "@geulion/lexer";

describe("Unicode 18.0.0 profile", () => {
  it("exposes its pinned Unicode data version", () => {
    expect(UNICODE_VERSION).toBe("18.0.0");
  });

  it("uses pinned XID data for characters newer than the host runtime", () => {
    expect(isIdentifierStart(0x0558)).toBe(true);
    expect(isIdentifierContinue(0x0558)).toBe(true);
  });

  it("filters default-ignorable and bidi controls from identifiers", () => {
    expect(isDefaultIgnorable(0x034f)).toBe(true);
    expect(isBidiControl(0x202e)).toBe(true);
    expect(isIdentifierContinue(0x034f)).toBe(false);
    expect(isIdentifierContinue(0x202e)).toBe(false);
  });

  it("uses Unicode White_Space rather than host whitespace properties", () => {
    expect(isUnicodeWhiteSpace(0x00a0)).toBe(true);
    expect(isUnicodeWhiteSpace(0x2007)).toBe(true);
    expect(isUnicodeWhiteSpace(0x200b)).toBe(false);
  });

  it("normalizes Hangul, canonical composites, and combining mark order to NFC", () => {
    expect(normalizeNfc("함수")).toBe("함수");
    expect(normalizeIdentifier("e\u0301")).toBe("é");
    expect(normalizeNfc("a\u0315\u0300")).toBe("à\u0315");
    expect(normalizeNfc("①")).toBe("①");
  });

  it("preserves strings that are visually similar but not canonically equivalent", () => {
    expect(normalizeNfc("a\u200b")).toBe("a\u200b");
    expect(normalizeNfc("K")).toBe("K");
  });
});
