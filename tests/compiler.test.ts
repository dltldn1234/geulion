import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSource, compileSource, renderDiagnostics } from "@geulion/compiler";

const document = readFileSync(
  fileURLToPath(new URL("../docs/language/examples.md", import.meta.url)),
  "utf8",
);

function exampleSource(id: string): string {
  const section = new RegExp(`### ${id} —[^\\n]*\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`).exec(
    document,
  );
  const source = section?.[1]?.match(/```geul\n([\s\S]*?)\n```/)?.[1];
  if (source === undefined) throw new Error(`Missing official example ${id}`);
  return source;
}

function input(path: string, source: string) {
  return { path, source: new TextEncoder().encode(source) };
}

describe("compiler integration and official conformance", () => {
  it.each([
    ["P-001", "시우 우수\n"],
    ["P-002", "0\n1\n2\n3\n4\n"],
    ["P-003", "1\n글리온\n"],
    ["P-004", "3\n"],
  ])("checks, compiles, and executes the official %s source in Node.js", (id, expectedOutput) => {
    const source = exampleSource(id);
    const sourceInput = input(`${id}.geul`, source);
    const checked = checkSource(sourceInput);
    expect(checked.success).toBe(true);
    if (checked.success) {
      expect(checked.program.checked).toBe(true);
      expect(checked.suppressedCount).toBe(0);
      expect("code" in checked).toBe(false);
    }

    const compiled = compileSource({ ...sourceInput, target: "node" });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.suppressedCount).toBe(0);
    expect(compiled.sourceMap).toMatchObject({
      version: 3,
      sources: [`${id}.geul`],
      sourcesContent: [source],
    });
    expect(compiled.mappings.length).toBeGreaterThan(0);

    const executed = spawnSync(process.execPath, ["--input-type=module", "-"], {
      input: compiled.code,
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(executed.error).toBeUndefined();
    expect(executed.status, executed.stderr).toBe(0);
    expect(executed.stdout).toBe(expectedOutput);
    expect(executed.stderr).toBe("");
  });

  it.each([
    ["N-001", "GE2003", "resolve"],
    ["N-002", "GE3001", "type"],
    ["N-003", "GE3003", "type"],
    ["N-004", "GE3006", "type"],
    ["N-005", "GE2001", "resolve"],
    ["N-006", "GE3002", "type"],
    ["N-007", "GE3005", "type"],
    ["N-008", "GE1001", "parse"],
  ])("rejects official %s with %s and emits no JavaScript", (id, code, phase) => {
    const sourceInput = input(`${id}.geul`, exampleSource(id));
    const checked = checkSource(sourceInput);
    const compiled = compileSource(sourceInput);
    for (const result of [checked, compiled]) {
      expect(result.success).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({ code, phase, path: `${id}.geul` });
      expect(result.diagnostics[0]?.range).not.toBeNull();
      expect("code" in result).toBe(false);
      expect("program" in result).toBe(false);
    }
  });

  it("stops after UTF-8 or lexical failure without adding parser/semantic errors or code", () => {
    for (const source of [Uint8Array.from([0xff]), new TextEncoder().encode("@")]) {
      const sourceInput = { path: "lexical.geul", source };
      for (const result of [checkSource(sourceInput), compileSource(sourceInput)]) {
        expect(result.success).toBe(false);
        expect(result.diagnostics.map(({ code }) => code)).toEqual(["GE0001"]);
        expect(result.diagnostics.every(({ phase }) => phase === "lex")).toBe(true);
        expect("code" in result).toBe(false);
        expect("program" in result).toBe(false);
      }
    }
  });

  it("stops at the first parser error without inventing entrypoint or type failures", () => {
    const sourceInput = input("parser.geul", "함수 보조() -> 없음 { 상수 값 = }");
    const result = compileSource(sourceInput);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: "GE1001", phase: "parse" });
    expect("code" in result).toBe(false);
  });

  it("preserves diagnostic sorting and the 100-error cap across resolution and type checking", () => {
    const reads = Array.from({ length: 105 }, (_, index) => `출력(미선언${index})`).join("\n");
    const source = `함수 시작() -> 없음 {\n상수 값: 정수 = "문자열"\n${reads}\n}`;
    const result = compileSource(input("many-errors.geul", source));
    expect(result.success).toBe(false);
    expect(result.diagnostics).toHaveLength(100);
    expect(result.suppressedCount).toBe(6);
    expect(result.diagnostics[0]?.code).toBe("GE3001");
    const positions = result.diagnostics.map(({ range }) => range?.start.byteOffset ?? -1);
    expect(
      positions.every((position, index) => index === 0 || position >= (positions[index - 1] ?? -1)),
    ).toBe(true);
    const rendered = renderDiagnostics(result.diagnostics, source, result.suppressedCount);
    expect(rendered).toContain("억제");
    expect(rendered).toContain("6");
    expect(rendered).toContain("도움말:");
    expect(rendered).toContain("many-errors.geul:");
    expect("code" in result).toBe(false);
  });

  it("renders source snippets, underlines, help, and a related earlier declaration", () => {
    const source = "함수 시작() -> 없음 {\n    상수 값 = 1\n    상수 값 = 2\n}";
    const result = checkSource(input("duplicate.geul", source));
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "GE2002",
      related: [{ path: "duplicate.geul" }],
    });
    const rendered = renderDiagnostics(result.diagnostics, source);
    expect(rendered).toContain("GE2002");
    expect(rendered).toContain("duplicate.geul:3:8");
    expect(rendered).toContain("상수 값 = 2");
    expect(rendered).toContain("상수 값 = 1");
    expect(rendered).toContain("^");
    expect(rendered).toContain("도움말:");
    expect(rendered).toContain("duplicate.geul:2:8");
  });
});
