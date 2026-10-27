import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSource, tokenizeSource } from "@geulion/compiler";

const examplesPath = fileURLToPath(new URL("../docs/language/examples.md", import.meta.url));
const examplesDocument = readFileSync(examplesPath, "utf8");

function exampleSource(id: string): string {
  const heading = new RegExp(`### ${id} —[^\\n]*\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`).exec(
    examplesDocument,
  );
  const fenced = heading?.[1]?.match(/```geul\n([\s\S]*?)\n```/);
  if (fenced?.[1] === undefined) throw new Error(`Example ${id} was not found in examples.md`);
  return fenced[1];
}

describe("compiler frontend", () => {
  it.each(["P-001", "P-002", "P-003", "P-004"])("accepts normative example %s", (id) => {
    const result = parseSource({
      path: `${id}.geul`,
      source: new TextEncoder().encode(exampleSource(id)),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.ast.kind).toBe("Program");
      expect(result.tokens.at(-1)?.kind).toBe("EndOfFile");
    }
  });

  it("reports N-008 as a parser error while leaving N-001 through N-007 to semantic analysis", () => {
    const n008 = parseSource({
      path: "N-008.geul",
      source: new TextEncoder().encode(exampleSource("N-008")),
    });
    expect(n008.success).toBe(false);
    if (!n008.success) expect(n008.diagnostics[0]?.code).toBe("GE1001");

    for (const id of ["N-001", "N-002", "N-003", "N-004", "N-005", "N-006", "N-007"]) {
      const result = parseSource({
        path: `${id}.geul`,
        source: new TextEncoder().encode(exampleSource(id)),
      });
      expect(result.success, `${id} is syntactically valid and belongs to semantic analysis`).toBe(
        true,
      );
    }
  });

  it("does not invoke parsing after a lexical failure", () => {
    const source = new TextEncoder().encode("함수 시작() -> 없음 { @ }");
    const lexical = tokenizeSource({ path: "invalid.geul", source });
    const parsed = parseSource({ path: "invalid.geul", source });

    expect(lexical.success).toBe(false);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.diagnostics.map(({ code }) => code)).toEqual(["GE0001"]);
      expect(parsed.diagnostics.every(({ phase }) => phase === "lex")).toBe(true);
    }
  });
});
