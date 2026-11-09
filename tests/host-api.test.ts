import { describe, expect, it } from "vitest";
import {
  decodeSaveEnvelope,
  encodeSaveEnvelope,
  SAVE_ENVELOPE_MAX_BYTES,
  SAVE_VALUE_MAX_COLLECTION_LENGTH,
  SAVE_VALUE_MAX_DEPTH,
} from "@geulion/host-api";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const applicationVersion = "1.2.3";

function encode(value: unknown) {
  return encodeSaveEnvelope(applicationVersion, value);
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    format: "geulion-save",
    envelopeVersion: 1,
    languageVersion: "0.3",
    applicationVersion,
    value: { kind: "integer", decimal: "42" },
    ...overrides,
  };
}

describe("GEULION v0.3 save envelope codec", () => {
  it("round-trips tagged values as compact UTF-8 JSON", () => {
    const value = {
      kind: "dictionary",
      entries: [
        ["text", { kind: "string", value: "안녕 🌱" }],
        [
          "items",
          {
            kind: "list",
            values: [{ kind: "none" }, { kind: "some", value: { kind: "real", value: "-0" } }],
          },
        ],
      ],
    };
    const encoded = encode(value);
    expect(encoded.kind).toBe("encoded");
    if (encoded.kind !== "encoded") return;
    const serialized = decoder.decode(encoded.bytes);
    expect(serialized).not.toContain(": ");
    expect(encoded.bytes.byteLength).toBeLessThanOrEqual(SAVE_ENVELOPE_MAX_BYTES);
    expect(decodeSaveEnvelope(encoded.bytes, applicationVersion)).toEqual({
      kind: "loaded",
      envelope: {
        format: "geulion-save",
        envelopeVersion: 1,
        languageVersion: "0.3",
        applicationVersion,
        value: {
          kind: "dictionary",
          entries: [
            [
              "items",
              {
                kind: "list",
                values: [{ kind: "none" }, { kind: "some", value: { kind: "real", value: "-0" } }],
              },
            ],
            ["text", { kind: "string", value: "안녕 🌱" }],
          ],
        },
      },
    });
  });

  it("represents absent storage separately from a saved none value", () => {
    expect(decodeSaveEnvelope(null, applicationVersion)).toEqual({ kind: "absent" });
    const encoded = encode({ kind: "none" });
    expect(encoded.kind).toBe("encoded");
    if (encoded.kind === "encoded")
      expect(decodeSaveEnvelope(encoded.bytes, applicationVersion)).toMatchObject({
        kind: "loaded",
        envelope: { value: { kind: "none" } },
      });
  });

  it("distinguishes malformed UTF-8 from malformed JSON", () => {
    expect(decodeSaveEnvelope(new Uint8Array([0xc3, 0x28]), applicationVersion)).toEqual({
      kind: "error",
      code: "invalid-utf8",
    });
    expect(decodeSaveEnvelope(encoder.encode("{"), applicationVersion)).toEqual({
      kind: "error",
      code: "invalid-json",
    });
  });

  it("rejects invalid envelope shape and unsupported format versions", () => {
    expect(decodeSaveEnvelope(jsonBytes(envelope({ extra: true })), applicationVersion)).toEqual({
      kind: "error",
      code: "invalid-envelope",
    });
    expect(
      decodeSaveEnvelope(jsonBytes(envelope({ envelopeVersion: 2 })), applicationVersion),
    ).toEqual({
      kind: "error",
      code: "unsupported-envelope-version",
    });
    expect(
      decodeSaveEnvelope(jsonBytes(envelope({ languageVersion: "0.4" })), applicationVersion),
    ).toEqual({
      kind: "error",
      code: "unsupported-language-version",
    });
    const duplicateEnvelopeField = decoder
      .decode(jsonBytes(envelope()))
      .replace('"envelopeVersion":1', '"envelopeVersion":1,"envelopeVersion":1');
    const duplicateNestedField = decoder
      .decode(jsonBytes(envelope()))
      .replace('"decimal":"42"', '"decimal":"42","decimal":"43"');
    expect(decodeSaveEnvelope(encoder.encode(duplicateEnvelopeField), applicationVersion)).toEqual({
      kind: "error",
      code: "invalid-envelope",
    });
    expect(decodeSaveEnvelope(encoder.encode(duplicateNestedField), applicationVersion)).toEqual({
      kind: "error",
      code: "invalid-envelope",
    });
  });

  it("validates application-version syntax and reports incompatibility explicitly", () => {
    expect(encodeSaveEnvelope("bad version", { kind: "none" })).toEqual({
      kind: "error",
      code: "invalid-application-version",
    });
    expect(decodeSaveEnvelope(jsonBytes(envelope({ applicationVersion: "2.0" })), "1.0")).toEqual({
      kind: "error",
      code: "incompatible-application-version",
    });
    expect(decodeSaveEnvelope(jsonBytes(envelope()), "bad version")).toEqual({
      kind: "error",
      code: "invalid-application-version",
    });
  });

  it("validates canonical signed 64-bit integers and real spellings", () => {
    expect(encode({ kind: "integer", decimal: "-9223372036854775808" }).kind).toBe("encoded");
    expect(encode({ kind: "integer", decimal: "9223372036854775807" }).kind).toBe("encoded");
    for (const decimal of ["+1", "01", "-0", "9223372036854775808", "-9223372036854775809"])
      expect(encode({ kind: "integer", decimal })).toEqual({
        kind: "error",
        code: "invalid-value",
      });
    for (const real of ["1.0", "01", "Infinity0", "-00"])
      expect(encode({ kind: "real", value: real })).toEqual({
        kind: "error",
        code: "invalid-value",
      });
    for (const real of ["NaN", "Infinity", "-Infinity", "-0", "1e+21"])
      expect(encode({ kind: "real", value: real }).kind).toBe("encoded");
  });

  it("rejects lone surrogates and sorts dictionary keys by Unicode scalar value", () => {
    expect(encode({ kind: "string", value: "\ud800" })).toEqual({
      kind: "error",
      code: "invalid-value",
    });
    const encoded = encode({
      kind: "dictionary",
      entries: [
        ["\u{10000}", { kind: "unit" }],
        ["\ue000", { kind: "unit" }],
      ],
    });
    expect(encoded.kind).toBe("encoded");
    if (encoded.kind === "encoded") {
      const parsed = JSON.parse(decoder.decode(encoded.bytes)) as {
        value: { entries: readonly (readonly [string, unknown])[] };
      };
      expect(parsed.value.entries.map(([key]) => key)).toEqual(["\ue000", "\u{10000}"]);
    }
  });

  it("enforces value-node and individual string limits", () => {
    const maximumString = "x".repeat(262_144);
    expect(encode({ kind: "string", value: maximumString }).kind).toBe("encoded");
    expect(encode({ kind: "string", value: `${maximumString}x` })).toEqual({
      kind: "error",
      code: "invalid-value",
    });

    const fullList = () => ({
      kind: "list",
      values: Array.from({ length: SAVE_VALUE_MAX_COLLECTION_LENGTH }, () => ({ kind: "unit" })),
    });
    expect(encode({ kind: "list", values: [fullList(), fullList(), fullList()] }).kind).toBe(
      "encoded",
    );
    expect(
      encode({ kind: "list", values: [fullList(), fullList(), fullList(), fullList()] }),
    ).toEqual({ kind: "error", code: "invalid-value" });
  });

  it("rejects accessors, toJSON hooks, duplicate keys, and cyclic values without running hooks", () => {
    let sideEffects = 0;
    const accessor = { kind: "string" };
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get() {
        sideEffects += 1;
        return "unexpected";
      },
    });
    const custom = {
      kind: "string",
      value: "safe",
      toJSON() {
        sideEffects += 1;
        return this;
      },
    };
    const cyclic: { kind: string; values?: unknown[] } = { kind: "list" };
    cyclic.values = [cyclic];
    expect(encode(accessor)).toEqual({ kind: "error", code: "invalid-value" });
    expect(encode(custom)).toEqual({ kind: "error", code: "invalid-value" });
    expect(
      encode({
        kind: "dictionary",
        entries: [
          ["same", { kind: "unit" }],
          ["same", { kind: "none" }],
        ],
      }),
    ).toEqual({ kind: "error", code: "invalid-value" });
    expect(encode(cyclic)).toEqual({ kind: "error", code: "invalid-value" });
    expect(sideEffects).toBe(0);
  });

  it("accepts the maximum collection and nesting depth, then rejects one beyond", () => {
    const atCollectionLimit = encode({
      kind: "list",
      values: Array.from({ length: SAVE_VALUE_MAX_COLLECTION_LENGTH }, () => ({ kind: "unit" })),
    });
    expect(atCollectionLimit.kind).toBe("encoded");
    expect(
      encode({
        kind: "list",
        values: Array.from({ length: SAVE_VALUE_MAX_COLLECTION_LENGTH + 1 }, () => ({
          kind: "unit",
        })),
      }),
    ).toEqual({
      kind: "error",
      code: "invalid-value",
    });

    let nested: unknown = { kind: "integer", decimal: "0" };
    for (let depth = 0; depth < SAVE_VALUE_MAX_DEPTH; depth += 1)
      nested = { kind: "some", value: nested };
    expect(encode(nested).kind).toBe("encoded");
    expect(encode({ kind: "some", value: nested })).toEqual({
      kind: "error",
      code: "invalid-value",
    });
  });

  it("rejects encoded envelopes above one MiB and accepts bounded values", () => {
    const justUnder = encode({
      kind: "list",
      values: Array.from({ length: 3 }, () => ({ kind: "string", value: "x".repeat(262_144) })),
    });
    expect(justUnder.kind).toBe("encoded");
    const tooLarge = encode({
      kind: "list",
      values: Array.from({ length: 4 }, () => ({ kind: "string", value: "x".repeat(262_144) })),
    });
    expect(tooLarge).toEqual({ kind: "error", code: "size-limit" });
    const oversizedInput = new Uint8Array(SAVE_ENVELOPE_MAX_BYTES + 1);
    expect(decodeSaveEnvelope(oversizedInput, applicationVersion)).toEqual({
      kind: "error",
      code: "size-limit",
    });
  });

  it("produces deterministic bytes for dictionaries with different insertion orders", () => {
    const first = encode({
      kind: "dictionary",
      entries: [
        ["b", { kind: "unit" }],
        ["a", { kind: "none" }],
      ],
    });
    const second = encode({
      kind: "dictionary",
      entries: [
        ["a", { kind: "none" }],
        ["b", { kind: "unit" }],
      ],
    });
    expect(first.kind).toBe("encoded");
    expect(second.kind).toBe("encoded");
    if (first.kind === "encoded" && second.kind === "encoded")
      expect(first.bytes).toEqual(second.bytes);
  });
});
