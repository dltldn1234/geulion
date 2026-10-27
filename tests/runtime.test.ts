import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { Diagnostic, SourceSpan } from "@geulion/ast";
import { createRuntime } from "@geulion/codegen-js";

const point = { byteOffset: 12, codePointOffset: 6, utf16Offset: 6, line: 2, column: 3 };
const span: SourceSpan = {
  start: point,
  end: { ...point, byteOffset: 15, codePointOffset: 7, utf16Offset: 7, column: 4 },
};

function runtime() {
  const writes: string[] = [];
  const diagnostics: Diagnostic[] = [];
  return {
    value: createRuntime(
      {
        write: (text) => {
          writes.push(text);
        },
        report: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
      "runtime.geul",
    ),
    writes,
    diagnostics,
  };
}

describe("GEULION minimal runtime", () => {
  it("classifies standard-output failures as GE4004 at the original output call", () => {
    const diagnostics: Diagnostic[] = [];
    const value = createRuntime(
      {
        write: () => {
          throw new Error("closed output");
        },
        report: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
      "output.geul",
    );
    expect(value.run(() => value.output(123n, span))).toBe(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "GE4004",
      phase: "runtime",
      severity: "error",
      path: "output.geul",
      range: span,
      related: [],
    });
    expect(diagnostics[0]?.help).toBeTruthy();
  });

  it("distinguishes internal exceptions from user runtime diagnostics without exposing JavaScript details", () => {
    const { value, diagnostics } = runtime();
    expect(
      value.run(() => {
        throw new Error("private implementation detail");
      }),
    ).toBe(2);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "GE9001",
      phase: "internal",
      path: null,
      range: null,
    });
    expect(diagnostics[0]?.message).not.toContain("private implementation detail");
  });

  it("stops immediately at the first runtime failure and preserves the failing expression span", () => {
    const { value, diagnostics, writes } = runtime();
    expect(
      value.run(() => {
        value.integerBinary("/", 1n, 0n, span);
        value.output("실행되면 안 됨", span);
      }),
    ).toBe(1);
    expect(writes).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "GE4002", range: span });
  });

  it("keeps Unit, empty option, and some(Unit) distinct and copies immutable collection storage", () => {
    const { value } = runtime();
    expect(value.equal(value.unit, value.none)).toBe(false);
    expect(value.equal(value.some(value.unit), value.none)).toBe(false);
    const original = [1n];
    const list = value.list(original);
    original[0] = 2n;
    expect(value.equal(value.index(list, 0n), value.some(1n))).toBe(true);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list.values)).toBe(true);
    const entries: [string, bigint][] = [["값", 1n]];
    const dictionary = value.dictionary(entries);
    entries[0] = ["다른값", 2n];
    expect(value.equal(value.index(dictionary, "값"), value.some(1n))).toBe(true);
    expect(Object.isFrozen(dictionary.entries[0])).toBe(true);
  });

  it("does not short-circuit structural equality on object identity when a collection contains NaN", () => {
    const { value } = runtime();
    const list = value.list([Number.NaN]);
    const dictionary = value.dictionary([["값", value.some(Number.NaN)]]);
    expect(value.equal(list, list)).toBe(false);
    expect(value.equal(dictionary, dictionary)).toBe(false);
    expect(
      value.equal(
        value.dictionary([
          ["가", 1n],
          ["나", 2n],
        ]),
        value.dictionary([
          ["나", 2n],
          ["가", 1n],
        ]),
      ),
    ).toBe(true);
  });

  it("sorts dictionary keys by Unicode scalar order and applies canonical recursive output", () => {
    const { value, writes } = runtime();
    value.output(
      value.dictionary([
        ["𐀀", value.some(value.unit)],
        ["\ue000", value.list([1n, -0, true])],
        ["\n", value.none],
      ]),
      span,
    );
    expect(writes).toEqual(['{"\\n": 비어있음, "\ue000": [1, -0.0, 참], "𐀀": 일부(없음)}\n']);
  });

  it("can be reconstructed from its compiled function source without captured module dependencies", () => {
    const standalone = runInNewContext(`(${createRuntime.toString()})`) as typeof createRuntime;
    const writes: string[] = [];
    const diagnostics: Diagnostic[] = [];
    const value = standalone(
      {
        write: (text) => {
          writes.push(text);
        },
        report: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
      "standalone.geul",
    );
    expect(value.run(() => value.output(value.integerBinary("+", 3n, 4n, span), span))).toBe(0);
    expect(writes).toEqual(["7\n"]);
    expect(diagnostics).toEqual([]);
  });
});
