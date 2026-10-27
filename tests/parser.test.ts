import { describe, expect, it } from "vitest";
import { SourceFile } from "@geulion/ast";
import { lex } from "@geulion/lexer";
import { parseTokens } from "@geulion/parser";

function parseText(text: string) {
  const source = SourceFile.fromText("parser-test.geul", text);
  const lexical = lex(source);
  if (!lexical.success)
    throw new Error(`Test fixture has lexical errors: ${lexical.diagnostics[0]?.message}`);
  return parseTokens(lexical.tokens, source.path);
}

function parsedProgram(text: string) {
  const result = parseText(text);
  if (!result.success)
    throw new Error(`Expected parse success, got ${result.diagnostics[0]?.code}`);
  return result.ast;
}

describe("GEULION parser", () => {
  it("parses P-001 declarations, inferred bindings, calls, and if/else blocks", () => {
    const ast = parsedProgram(`함수 더하기(가: 정수, 나: 정수) -> 정수 {
    반환 가 + 나
}

함수 시작() -> 없음 {
    상수 이름: 문자열 = "시우"
    변수 점수 = 더하기(40, 55)
    만약 점수 >= 90 {
        출력(이름 + " 우수")
    } 아니면 {
        출력("보통")
    }
}`);

    expect(ast.functions).toHaveLength(2);
    expect(ast.functions[0]).toMatchObject({
      kind: "FunctionDeclaration",
      name: { raw: "더하기", normalized: "더하기" },
      parameters: [{ name: { raw: "가" } }, { name: { raw: "나" } }],
      body: {
        statements: [
          { kind: "ReturnStatement", value: { kind: "BinaryExpression", operator: "+" } },
        ],
      },
    });
    expect(ast.functions[1]?.body.statements.map(({ kind }) => kind)).toEqual([
      "VariableDeclaration",
      "VariableDeclaration",
      "IfStatement",
    ]);
  });

  it("parses P-002 while loops and assignment statements", () => {
    const ast = parsedProgram(`함수 시작() -> 없음 {
    변수 수 = 0
    동안 수 < 5 {
        출력(수)
        수 = 수 + 1
    }
}`);
    const loop = ast.functions[0]?.body.statements[1];

    expect(loop).toMatchObject({
      kind: "WhileStatement",
      condition: { kind: "BinaryExpression", operator: "<" },
      body: { statements: [{ kind: "ExpressionStatement" }, { kind: "Assignment" }] },
    });
  });

  it("parses P-003 collection literals, indexing, and optional coalescing", () => {
    const ast = parsedProgram(`함수 시작() -> 없음 {
    상수 수들: 목록[정수] = [1, 2, 3]
    상수 첫째: 선택[정수] = 수들[0]
    상수 이름표: 사전[문자열] = {"언어": "글리온"}
    상수 이름: 선택[문자열] = 이름표["언어"]
    출력(첫째 ?? -1)
    출력(이름 ?? "없음")
}`);
    const statements = ast.functions[0]?.body.statements;

    const listDeclaration = statements?.[0];
    expect(listDeclaration?.kind).toBe("VariableDeclaration");
    if (listDeclaration?.kind === "VariableDeclaration") {
      expect(listDeclaration.annotation).toMatchObject({
        kind: "CollectionType",
        collection: "목록",
      });
      expect(listDeclaration.initializer.kind).toBe("ListExpression");
      if (listDeclaration.initializer.kind === "ListExpression") {
        expect(listDeclaration.initializer.elements.map(({ kind }) => kind)).toEqual([
          "IntegerLiteralExpression",
          "IntegerLiteralExpression",
          "IntegerLiteralExpression",
        ]);
      }
    }
    expect(statements?.[2]).toMatchObject({
      kind: "VariableDeclaration",
      annotation: { kind: "CollectionType", collection: "사전" },
      initializer: { kind: "DictionaryExpression", entries: [{ kind: "DictionaryEntry" }] },
    });
    expect(statements?.[4]).toMatchObject({
      kind: "ExpressionStatement",
      expression: {
        arguments: [
          {
            kind: "BinaryExpression",
            operator: "??",
            right: { kind: "UnaryExpression", operator: "-" },
          },
        ],
      },
    });
  });

  it("parses P-004 multiline function headers and explicit calls", () => {
    const ast = parsedProgram(`함수 시작()
    -> 없음
{
    상수 반올림전: 실수 = 3.5
    상수 정수값: 정수 = 정수로(반올림전)
    출력(정수값)
}`);
    const entry = ast.functions[0];
    expect(entry?.name.normalized).toBe("시작");
    expect(entry?.returnType).toMatchObject({ kind: "PrimitiveType", name: "없음" });
    expect(entry?.body.statements.map(({ kind }) => kind)).toEqual([
      "VariableDeclaration",
      "VariableDeclaration",
      "ExpressionStatement",
    ]);
  });

  it("uses the specified precedence and associativity", () => {
    const ast = parsedProgram(`함수 시작() -> 없음 {
    출력(1 + 2 * 3 ?? 4 ?? 5)
    출력(아니다 참 또는 거짓 그리고 참)
}`);
    const call = ast.functions[0]?.body.statements[0];

    expect(call).toMatchObject({
      kind: "ExpressionStatement",
      expression: {
        arguments: [
          {
            kind: "BinaryExpression",
            operator: "??",
            left: {
              kind: "BinaryExpression",
              operator: "+",
              right: { kind: "BinaryExpression", operator: "*" },
            },
            right: {
              kind: "BinaryExpression",
              operator: "??",
              left: { kind: "IntegerLiteralExpression", raw: "4" },
            },
          },
        ],
      },
    });

    const logic = ast.functions[0]?.body.statements[1];
    expect(logic).toMatchObject({
      kind: "ExpressionStatement",
      expression: {
        arguments: [
          {
            kind: "BinaryExpression",
            operator: "또는",
            left: { kind: "UnaryExpression", operator: "아니다" },
            right: { kind: "BinaryExpression", operator: "그리고" },
          },
        ],
      },
    });
  });

  it("rejects unparenthesized comparison and equality chains", () => {
    for (const expression of ["1 < 2 < 3", "1 == 2 != 3"]) {
      const result = parseText(`함수 시작() -> 없음 { 출력(${expression}) }`);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.diagnostics[0]?.code).toBe("GE1002");
    }

    expect(parseText("함수 시작() -> 없음 { 출력((1 < 2) == 참) }").success).toBe(true);
  });

  it("parses else-if, nested blocks, bare/value returns, break, and continue", () => {
    const ast = parsedProgram(`함수 보조(값: 정수) -> 정수 {
    만약 값 < 0 {
        중단
    } 아니면
    만약 값 == 0 {
        계속
    } 아니면 {
        반환 값
    }
}

함수 시작() -> 없음 {
    반환
}`);

    expect(ast.functions[0]?.body.statements[0]).toMatchObject({
      kind: "IfStatement",
      elseBranch: { kind: "IfStatement", elseBranch: { kind: "BlockStatement" } },
    });
    expect(ast.functions[1]?.body.statements[0]).toMatchObject({
      kind: "ReturnStatement",
      value: null,
    });
  });

  it("applies newline continuation only in the documented grammar contexts", () => {
    const ast = parsedProgram(`함수 시작()
    -> 없음
{
    상수 값: 목록[
        정수
    ] =
    [
        1,
        2,
    ]
    만약
        참
    {
        출력(
            "가" +
            "나",
        )
    }
    아니면
    {
        출력({
            "키": 일부(
                값
            ),
        })
    }
}`);
    expect(ast.functions[0]?.body.statements).toHaveLength(2);
    expect(ast.functions[0]?.body.statements[1]).toMatchObject({
      kind: "IfStatement",
      elseBranch: { kind: "BlockStatement" },
    });
  });

  it("keeps statement separators significant and requires call-only expression statements", () => {
    expect(parseText("함수 시작() -> 없음 { 출력(1); 출력(2) }").success).toBe(true);
    expect(parseText("함수 시작() -> 없음 { 1 + 2 }").success).toBe(false);
    expect(parseText("함수 시작() -> 없음 { 출력(1)\n+ 출력(2) }").success).toBe(false);
  });

  it("allows an empty or non-entry program syntactically", () => {
    expect(parsedProgram("").functions).toEqual([]);
    expect(parsedProgram("함수 보조() -> 없음 { 반환 }").functions).toHaveLength(1);
  });

  it("returns only the first syntax diagnostic and does not return an AST on failure", () => {
    const result = parseText(`함수 시작() -> 없음 {
    상수 값: 정수 =
}`);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        code: "GE1001",
        phase: "parse",
        path: "parser-test.geul",
        range: { start: { line: 3 }, end: { line: 3 } },
      });
      expect("ast" in result).toBe(false);
    }
  });

  it.each([
    ["함수 시작() -> 없음 { 출력(1)", "GE1002"],
    ["함수 시작() -> 없음 { @ }", "GE0001"],
  ])("distinguishes parser failures from lexer failures", (text, expected) => {
    const lexical = lex(SourceFile.fromText("bad.geul", text));
    if (expected === "GE0001") {
      expect(lexical.success).toBe(false);
      return;
    }
    expect(lexical.success).toBe(true);
    if (lexical.success) {
      const parsed = parseTokens(lexical.tokens, "bad.geul");
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.diagnostics[0]?.code).toBe(expected);
    }
  });
});
