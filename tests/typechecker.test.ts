import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { visitAst, type VariableDeclarationNode } from "@geulion/ast";
import { parseSource } from "@geulion/compiler";
import { analyzeProgram, typeName } from "@geulion/semantic";

function analyzeText(source: string) {
  const parsed = parseSource({ path: "types.geul", source: new TextEncoder().encode(source) });
  if (!parsed.success)
    throw new Error(`Invalid type-checker fixture: ${parsed.diagnostics[0]?.code}`);
  return analyzeProgram(parsed.ast, "types.geul");
}

function inMain(body: string) {
  return analyzeText(`함수 시작() -> 없음 {\n${body}\n}`);
}

function codes(source: string) {
  return analyzeText(source).diagnostics.map(({ code }) => code);
}

describe("GEULION static type checking", () => {
  it("infers primitive bindings and records typed expression and symbol metadata", () => {
    const result = inMain(`변수 수 = 17
상수 실수값 = 1.25
상수 이름 = "GEULION"
상수 조건 = 참
상수 단위 = 없음
수 = 수 + 1
출력(실수값)`);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const names = new Map<string, string>();
    for (const symbol of result.program.symbols.values()) {
      const type = result.program.symbolTypes.get(symbol.id);
      if (type !== undefined) names.set(symbol.name, typeName(type));
    }
    expect(names.get("수")).toBe("정수");
    expect(names.get("실수값")).toBe("실수");
    expect(names.get("이름")).toBe("문자열");
    expect(names.get("조건")).toBe("불리언");
    expect(names.get("단위")).toBe("없음");
    const declaration = result.program.ast.functions[0]?.body.statements[0];
    if (declaration?.kind !== "VariableDeclaration") throw new Error("Missing declaration");
    expect(
      typeName(result.program.expressionTypes.get(declaration.initializer) ?? { kind: "error" }),
    ).toBe("정수");
    expect(result.suppressedCount).toBe(0);
  });

  it("propagates collection and optional context through nested empty values", () => {
    const result = inMain(`상수 목록값: 목록[선택[정수]] = [비어있음, 일부(1)]
상수 빈목록: 목록[정수] = []
상수 빈사전: 사전[문자열] = {}
상수 빈선택: 선택[정수] = 비어있음
상수 중첩: 목록[사전[선택[정수]]] = [{}, {"값": 비어있음}]
상수 일부목록: 선택[목록[정수]] = 일부([])
출력(빈목록[0] ?? 0)
출력(빈사전["가"] ?? "없음")`);
    expect(result.success).toBe(true);
  });

  it("infers homogeneous sibling collection types without depending on an empty first element", () => {
    const result = inMain("상수 값 = [[], [1]]\n출력(값)");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const declaration = result.program.ast.functions[0]?.body.statements[0];
    if (declaration?.kind !== "VariableDeclaration") throw new Error("Missing declaration");
    const type = result.program.expressionTypes.get(declaration.initializer);
    expect(type === undefined ? undefined : typeName(type)).toBe("목록[목록[정수]]");
  });

  it.each(["[]", "{}", "비어있음", "일부([])"])("requires a type context for %s", (expression) => {
    const result = inMain(`상수 값 = ${expression}`);
    expect(result.success).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("GE3006");
    expect("program" in result).toBe(false);
  });

  it("uses parameter and return signatures as a context for empty literals", () => {
    const result = analyzeText(`함수 받아(값: 목록[선택[정수]]) -> 선택[목록[정수]] {
    반환 일부([])
}
함수 시작() -> 없음 { 출력(받아([비어있음])) }`);
    expect(result.success).toBe(true);
  });

  it.each([
    '상수 값: 정수 = "숫자"',
    "변수 값 = 1; 값 = 1.0",
    '상수 값 = [1, "하나"]',
    '상수 값 = {"가": 1, "나": 참}',
    "상수 값: 선택[정수] = 일부(1.0)",
  ])("rejects a mismatched declaration, assignment, or collection: %s", (body) => {
    expect(inMain(body).diagnostics.map(({ code }) => code)).toContain("GE3001");
  });

  it.each([
    '"숫자: " + 10',
    "1 + 1.0",
    '"가" < "나"',
    "1.0 % 1.0",
    "1 그리고 참",
    "아니다 1",
    "-없음",
    '[1]["가"]',
    '{"가": 1}[0]',
    '일부(1) ?? "하나"',
    "1 == 1.0",
  ])("rejects unsupported operator operands without implicit conversion: %s", (expression) => {
    const result = inMain(`출력(${expression})`);
    expect(result.success).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("GE3002");
  });

  it("rejects bare function values", () => {
    expect(codes("함수 보조() -> 없음 {}\n함수 시작() -> 없음 { 상수 값 = 보조 }")).toEqual([
      "GE3002",
    ]);
  });

  it.each([
    "함수 보조(값: 정수) -> 없음 {}\n함수 시작() -> 없음 { 보조() }",
    "함수 보조(값: 정수) -> 없음 {}\n함수 시작() -> 없음 { 보조(참) }",
    "함수 보조() -> 정수 { 반환 참 }\n함수 시작() -> 없음 {}",
    "함수 보조() -> 정수 { 반환 }\n함수 시작() -> 없음 {}",
    "함수 시작() -> 없음 { 반환 1 }",
  ])("checks exact call and return signatures", (source) => {
    expect(codes(source)).toContain("GE3001");
  });

  it("allows recursive and mutually recursive typed calls", () => {
    const result = analyzeText(`함수 짝수(수: 정수) -> 불리언 {
    만약 수 == 0 { 반환 참 } 아니면 { 반환 홀수(수 - 1) }
}
함수 홀수(수: 정수) -> 불리언 {
    만약 수 == 0 { 반환 거짓 } 아니면 { 반환 짝수(수 - 1) }
}
함수 시작() -> 없음 { 출력(짝수(4)) }`);
    expect(result.success).toBe(true);
  });

  it("permits rebinding variables but rejects constants and parameters", () => {
    expect(inMain("변수 값 = 1; 값 = 2").success).toBe(true);
    expect(inMain("상수 값 = 1; 값 = 2").diagnostics.map(({ code }) => code)).toEqual(["GE3003"]);
    expect(codes("함수 보조(값: 정수) -> 없음 { 값 = 2 }\n함수 시작() -> 없음 {}")).toContain(
      "GE3003",
    );
  });

  it("checks boolean conditions and loop control nesting", () => {
    expect(inMain('만약 1 {}\n동안 "참" {}').diagnostics.map(({ code }) => code)).toEqual([
      "GE3002",
      "GE3002",
    ]);
    expect(inMain("중단\n계속").diagnostics.map(({ code }) => code)).toEqual(["GE3004", "GE3004"]);
    expect(inMain("동안 참 { 만약 거짓 { 중단 } 아니면 { 계속 } }").success).toBe(true);
  });

  it("requires complete returns and does not assume while executes once", () => {
    expect(codes("함수 보조() -> 정수 { 동안 참 { 반환 1 } }\n함수 시작() -> 없음 {}")).toContain(
      "GE3005",
    );
    expect(
      codes("함수 보조(조건: 불리언) -> 정수 { 만약 조건 { 반환 1 } }\n함수 시작() -> 없음 {}"),
    ).toContain("GE3005");
    const complete = analyzeText(`함수 보조(조건: 불리언) -> 정수 {
    만약 조건 { { 반환 1 } } 아니면 만약 거짓 { 반환 2 } 아니면 { 반환 3 }
}
함수 시작() -> 없음 { 반환 }`);
    expect(complete.success).toBe(true);
  });

  it("accepts signed-64-bit boundaries with the direct grouped negative-literal exception", () => {
    const result = inMain(`상수 최대 = 9223372036854775807
상수 최소 = -(9223372036854775808)
상수 실행시오버플로 = -(-9223372036854775808)
상수 계산시오버플로 = 최대 + 1`);
    expect(result.success).toBe(true);
    if (result.success) expect(result.program.signedMinimumLiterals.size).toBe(2);
  });

  it.each(["9223372036854775808", "-9223372036854775809", "-(+9223372036854775808)", "1e400"])(
    "rejects an out-of-range numeric literal: %s",
    (expression) => {
      expect(inMain(`상수 값 = ${expression}`).diagnostics.map(({ code }) => code)).toContain(
        "GE3007",
      );
    },
  );

  it("allows real underflow, subnormals and runtime-only infinities", () => {
    expect(
      inMain(
        "상수 작은값 = 1e-999\n상수 최소값 = 5e-324\n상수 무한대 = 1.0 / 0.0\n상수 비수 = 0.0 / 0.0",
      ).success,
    ).toBe(true);
  });

  it("compares dictionary keys by decoded scalar sequence without normalizing strings", () => {
    expect(inMain('상수 값 = {"가": 1, "가": 2}').diagnostics.map(({ code }) => code)).toEqual([
      "GE3008",
    ]);
    expect(
      inMain(String.raw`상수 값 = {"a": 1, "\u{61}": 2}`).diagnostics.map(({ code }) => code),
    ).toEqual(["GE3008"]);
    expect(inMain('상수 값 = {"가": 1, "가": 2}').success).toBe(true);
  });

  it("keeps resolved binding identity and types when a nested declaration shadows a name", () => {
    const result = inMain('상수 값 = 1\n{ 상수 값 = "안쪽"; 출력(값) }\n출력(값)');
    expect(result.success).toBe(true);
    if (!result.success) return;
    const declarations: VariableDeclarationNode[] = [];
    visitAst(result.program.ast, (node) => {
      if (node.kind === "VariableDeclaration") declarations.push(node);
    });
    expect(
      declarations.map((node) => {
        const id = result.program.references.get(node.name);
        const type = id === undefined ? undefined : result.program.symbolTypes.get(id);
        return type === undefined ? undefined : typeName(type);
      }),
    ).toEqual(["정수", "문자열"]);
  });

  it("collects independent name/type diagnostics in source order without cascading from an error type", () => {
    const result = inMain('상수 값 = 미선언 + 1\n상수 다른값: 정수 = "문자열"');
    expect(result.success).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["GE2001", "GE3001"]);
    expect(result.diagnostics.map(({ range }) => range?.start.line)).toEqual([2, 3]);
    expect("program" in result).toBe(false);
  });

  it("rejects the official N-001 through N-007 examples with their assigned diagnostic codes", () => {
    const document = readFileSync(
      fileURLToPath(new URL("../docs/language/examples.md", import.meta.url)),
      "utf8",
    );
    const expected = ["GE2003", "GE3001", "GE3003", "GE3006", "GE2001", "GE3002", "GE3005"];
    for (const [index, code] of expected.entries()) {
      const id = `N-${String(index + 1).padStart(3, "0")}`;
      const section = new RegExp(`### ${id} —[^\\n]*\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`).exec(
        document,
      );
      const source = section?.[1]?.match(/```geul\n([\s\S]*?)\n```/)?.[1];
      if (source === undefined) throw new Error(`Missing official example ${id}`);
      expect(codes(source), id).toContain(code);
    }
  });
});
