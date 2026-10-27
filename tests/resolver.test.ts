import { describe, expect, it } from "vitest";
import {
  visitAst,
  type IdentifierExpressionNode,
  type VariableDeclarationNode,
} from "@geulion/ast";
import { parseSource } from "@geulion/compiler";
import { resolveProgram } from "@geulion/semantic";

function resolveText(source: string) {
  const parsed = parseSource({ path: "resolver.geul", source: new TextEncoder().encode(source) });
  if (!parsed.success) throw new Error(`Invalid resolver fixture: ${parsed.diagnostics[0]?.code}`);
  return resolveProgram(parsed.ast, "resolver.geul");
}

describe("semantic name resolution", () => {
  it("collects function signatures before resolving recursive and mutually recursive calls", () => {
    const result = resolveText(`함수 시작() -> 없음 { 출력(짝수(4)); 출력(합계(3)) }
함수 짝수(수: 정수) -> 불리언 {
    만약 수 == 0 { 반환 참 }
    반환 홀수(수 - 1)
}
함수 홀수(수: 정수) -> 불리언 {
    만약 수 == 0 { 반환 거짓 }
    반환 짝수(수 - 1)
}
함수 합계(수: 정수) -> 정수 {
    만약 수 == 0 { 반환 0 }
    반환 수 + 합계(수 - 1)
}`);
    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.program.functions.get("합계")?.signature.parameters).toHaveLength(1);

    const calls: [string, number | undefined][] = [];
    visitAst(result.program.ast, (node) => {
      if (node.kind === "CallExpression") {
        calls.push([node.callee.normalized, result.program.references.get(node.callee)]);
      }
    });
    for (const [name, id] of calls) expect(id).toBe(result.program.functions.get(name)?.id);
  });

  it("assigns distinct identities to shadowed bindings and resolves an initializer against its outer scope", () => {
    const result = resolveText(`함수 시작() -> 없음 {
    변수 값 = 1
    {
        상수 값 = 값 + 1
        출력(값)
    }
    출력(값)
}`);
    expect(result.success).toBe(true);
    const declarations: VariableDeclarationNode[] = [];
    const reads: IdentifierExpressionNode[] = [];
    visitAst(result.program.ast, (node) => {
      if (node.kind === "VariableDeclaration") declarations.push(node);
      if (node.kind === "IdentifierExpression") reads.push(node);
    });
    const outer = declarations[0];
    const inner = declarations[1];
    if (outer === undefined || inner === undefined) throw new Error("Missing bindings");
    const outerId = result.program.references.get(outer.name);
    const innerId = result.program.references.get(inner.name);
    expect(outerId).toBeDefined();
    expect(innerId).toBeDefined();
    expect(innerId).not.toBe(outerId);
    expect(reads.map((read) => result.program.references.get(read.name))).toEqual([
      outerId,
      innerId,
      outerId,
    ]);
    expect(result.program.symbols.get(outerId ?? -1)).toMatchObject({ mutable: true });
    expect(result.program.symbols.get(innerId ?? -1)).toMatchObject({ mutable: false });
  });

  it("rejects NFC-equivalent declarations and reports the earlier source location", () => {
    const result = resolveText(`함수 시작() -> 없음 {
    상수 가 = 1
    상수 가 = 2
}`);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "GE2002",
      phase: "resolve",
      path: "resolver.geul",
      range: { start: { line: 3 } },
      related: [{ path: "resolver.geul", range: { start: { line: 2 } } }],
    });
  });

  it.each([
    "함수 시작() -> 없음 {}\n함수 보조() -> 없음 {}\n함수 보조() -> 없음 {}",
    "함수 시작() -> 없음 {}\n함수 출력() -> 없음 {}",
    "함수 시작() -> 없음 { 상수 출력 = 1 }",
    "함수 시작() -> 없음 { { 변수 보조 = 1 } }\n함수 보조() -> 없음 {}",
  ])("rejects duplicate functions and value/function or prelude collisions", (source) => {
    const result = resolveText(source);
    expect(result.success).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("GE2002");
    expect(
      result.diagnostics.every(({ message, help }) => message.length > 0 && help !== null),
    ).toBe(true);
  });

  it("shares the function body scope with parameters while allowing nested parameter shadowing", () => {
    const duplicate = resolveText(`함수 보조(값: 정수) -> 없음 { 상수 값 = 1 }
함수 시작() -> 없음 {}`);
    expect(duplicate.diagnostics.map(({ code }) => code)).toEqual(["GE2002"]);
    expect(duplicate.diagnostics[0]?.related).toHaveLength(1);

    const nested = resolveText(`함수 보조(값: 정수) -> 없음 { { 상수 값 = 값; 출력(값) } }
함수 시작() -> 없음 {}`);
    expect(nested.success).toBe(true);
    const values = [...nested.program.symbols.values()].filter((symbol) => symbol.name === "값");
    expect(values).toHaveLength(2);
    expect(values[0]?.scopeId).not.toBe(values[1]?.scopeId);
  });

  it("reports undefined names, unresolved calls, and self-initialization without an outer binding", () => {
    const result = resolveText(`함수 시작() -> 없음 {
    상수 값 = 값
    출력(사용자이름)
    미선언함수()
}`);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["GE2001", "GE2001", "GE2001"]);
    expect(result.diagnostics.map(({ range }) => range?.start.line)).toEqual([2, 3, 4]);
  });

  it("resolves a bare function reference so the type checker can reject function values", () => {
    const result = resolveText(`함수 보조() -> 없음 {}
함수 시작() -> 없음 { 상수 값 = 보조 }`);
    expect(result.success).toBe(true);
    const references: IdentifierExpressionNode[] = [];
    visitAst(result.program.ast, (node) => {
      if (node.kind === "IdentifierExpression") references.push(node);
    });
    const reference = references[0];
    if (reference === undefined) throw new Error("Missing reference");
    expect(result.program.references.get(reference.name)).toBe(
      result.program.functions.get("보조")?.id,
    );
  });

  it.each([
    ["함수 보조() -> 없음 {}", "missing"],
    ["함수 시작(값: 정수) -> 없음 {}", "parameter"],
    ["함수 시작() -> 정수 { 반환 1 }", "return"],
  ])("rejects an invalid entrypoint: %s (%s)", (source) => {
    const result = resolveText(source);
    expect(result.success).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("GE2003");
  });

  it("accepts one valid entrypoint and diagnoses a duplicate entrypoint independently", () => {
    const valid = resolveText("함수 시작() -> 없음 {}");
    expect(valid.success).toBe(true);
    expect(valid.program.entrypoint?.name).toBe("시작");

    const duplicate = resolveText("함수 시작() -> 없음 {}\n함수 시작() -> 없음 {}");
    expect(duplicate.success).toBe(false);
    expect(duplicate.program.entrypoint).toBeNull();
    expect(duplicate.diagnostics.map(({ code }) => code)).toEqual(["GE2002", "GE2003"]);
    expect(duplicate.diagnostics.every(({ related }) => related.length === 1)).toBe(true);
  });

  it("sorts independently discovered diagnostics before applying the 100-error limit", () => {
    const reads = Array.from({ length: 105 }, (_, index) => `출력(미선언${index})`).join("\n");
    const result = resolveText(`함수 시작() -> 없음 {\n${reads}\n}
함수 보조() -> 없음 {}
함수 보조() -> 없음 {}`);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toHaveLength(100);
    expect(result.suppressedCount).toBe(6);
    expect(result.diagnostics.every(({ code }) => code === "GE2001")).toBe(true);
    const offsets = result.diagnostics.map(({ range }) => range?.start.byteOffset ?? -1);
    expect(
      offsets.every((offset, index) => index === 0 || offset > (offsets[index - 1] ?? -1)),
    ).toBe(true);
  });
});
