import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { SourceMap } from "node:module";
import { describe, expect, it } from "vitest";
import { parseSource } from "@geulion/compiler";
import { analyzeProgram } from "@geulion/semantic";
import { generateJavaScript } from "@geulion/codegen-js";

const fixturePath = "codegen.geul";

function compile(source: string) {
  const parsed = parseSource({ path: fixturePath, source: new TextEncoder().encode(source) });
  if (!parsed.success) throw new Error(`Invalid syntax fixture: ${parsed.diagnostics[0]?.message}`);
  const analyzed = analyzeProgram(parsed.ast, fixturePath);
  if (!analyzed.success)
    throw new Error(`Invalid semantic fixture: ${analyzed.diagnostics[0]?.message}`);
  return generateJavaScript(analyzed.program, { sourceText: source });
}

function main(body: string): string {
  return `함수 시작() -> 없음 {\n    ${body.split("\n").join("\n    ")}\n}`;
}

function execute(source: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: compile(source).code,
    encoding: "utf8",
    timeout: 5_000,
  });
}

function expectOutput(source: string, stdout: string) {
  const result = execute(source);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(stdout);
  expect(result.stderr).toBe("");
}

describe("JavaScript code generation and runtime", () => {
  it("executes recursive and mutually recursive functions with collected signatures", () => {
    expectOutput(
      `함수 팩토리얼(수: 정수) -> 정수 {
    만약 수 <= 1 { 반환 1 } 아니면 { 반환 수 * 팩토리얼(수 - 1) }
}
함수 짝수(수: 정수) -> 불리언 {
    만약 수 == 0 { 반환 참 } 아니면 { 반환 홀수(수 - 1) }
}
함수 홀수(수: 정수) -> 불리언 {
    만약 수 == 0 { 반환 거짓 } 아니면 { 반환 짝수(수 - 1) }
}
함수 시작() -> 없음 {
    출력(팩토리얼(6))
    출력(짝수(8))
    출력(홀수(8))
}`,
      "720\n참\n거짓\n",
    );
  });

  it("preserves lexical binding identity and invokes the entrypoint exactly once", () => {
    expectOutput(
      main(`상수 값 = 10
{
    상수 값 = 값 + 1
    출력(값)
}
출력(값)
상수 __g_runtime = "한 번"
출력(__g_runtime)`),
      "11\n10\n한 번\n",
    );
  });

  it("emits assignment, while, break, continue, and arithmetic precedence", () => {
    expectOutput(
      main(`변수 수 = 0
변수 합 = 0
동안 수 < 6 {
    수 = 수 + 1
    만약 수 == 2 { 계속 }
    만약 수 == 5 { 중단 }
    합 = 합 + 수
}
출력(합)
출력(1 + 2 * 3)
출력((1 + 2) * 3)
출력(10 - 3 - 2)`),
      "8\n7\n9\n5\n",
    );
  });

  it("preserves signed 64-bit boundaries, truncating division, and remainder", () => {
    expectOutput(
      main(`출력(9223372036854775807)
출력(-(9223372036854775808))
출력(-7 / 3)
출력(7 / -3)
출력(-7 % 3)
출력(7 % -3)
출력(-9223372036854775808 % -1)`),
      "9223372036854775807\n-9223372036854775808\n-2\n-2\n-1\n1\n0\n",
    );
  });

  it.each([
    ["9223372036854775807 + 1", "GE4001"],
    ["-9223372036854775808 - 1", "GE4001"],
    ["9223372036854775807 * 2", "GE4001"],
    ["-9223372036854775808 / -1", "GE4001"],
    ["-(-9223372036854775808)", "GE4001"],
    ["1 / 0", "GE4002"],
    ["1 % 0", "GE4002"],
  ])("reports the first runtime error for %s", (expression, code) => {
    const result = execute(main(`출력(${expression})\n출력("실행되면 안 됨")`));
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(code);
    expect(result.stderr).toContain(`${fixturePath}:2:8`);
    expect(result.stderr).not.toContain("at ");
  });

  it("reports a real standard-output write failure at the original call span", () => {
    const stdout = openSync("/dev/null", "r");
    try {
      const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
        input: compile(main('출력("출력 실패")')).code,
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["pipe", stdout, "pipe"],
      });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("GE4004");
      expect(result.stderr).toContain(`${fixturePath}:2:5`);
      expect(result.stderr).not.toContain("at ");
    } finally {
      closeSync(stdout);
    }
  });

  it("preserves binary64 special values, signed zero, and IEEE comparison", () => {
    expectOutput(
      main(`출력(1.0)
출력(0.0)
출력(-0.0)
출력(1.0 / 0.0)
출력(-1.0 / 0.0)
출력(0.0 / 0.0)
상수 무효 = 0.0 / 0.0
출력(무효 == 무효)
출력(무효 != 무효)
출력(무효 < 1.0)
출력(0.0 == -0.0)
출력(1.5 + 2.25)`),
      "1.0\n0.0\n-0.0\nInfinity\n-Infinity\nNaN\n거짓\n참\n거짓\n참\n3.75\n",
    );
  });

  it("prints primitive and nested collection values canonically", () => {
    expectOutput(
      main(`출력("안녕" + "하세요")
출력(참)
출력(거짓)
출력(없음)
상수 값: 목록[선택[없음]] = [일부(없음), 비어있음]
출력(값)
상수 사전값: 사전[선택[정수]] = {"나": 일부(2), "가": 비어있음}
출력(사전값)
상수 빈목록: 목록[정수] = []
출력(빈목록)`),
      '안녕하세요\n참\n거짓\n없음\n[일부(없음), 비어있음]\n{"가": 비어있음, "나": 일부(2)}\n[]\n',
    );
  });

  it("returns tagged optionals for safe indexing and distinguishes Unit from empty", () => {
    expectOutput(
      main(`상수 값 = [10, 20]
출력(값[0])
출력(값[-1])
출력(값[9223372036854775807])
상수 사전값 = {"__proto__": 7}
출력(사전값["__proto__"])
출력(사전값["없는 키"])
상수 빈값: 선택[없음] = 비어있음
출력(일부(없음) == 빈값)
출력(일부(없음))
출력(빈값)`),
      "일부(10)\n비어있음\n비어있음\n일부(7)\n비어있음\n거짓\n일부(없음)\n비어있음\n",
    );
  });

  it("sorts dictionary output by Unicode scalar order and preserves exact string keys", () => {
    expectOutput(
      main(String.raw`출력({"\u{10000}": 2, "\u{e000}": 1})
출력({"가": 1, "가": 2})
출력({"\u{0}": 1, "\u{8}": 2, "\u{c}": 3, "\n": 4, "\r": 5, "\t": 6, "\"": 7, "\\": 8})`),
      '{"\ue000": 1, "𐀀": 2}\n{"가": 2, "가": 1}\n{"\\u0000": 1, "\\b": 2, "\\t": 6, "\\n": 4, "\\f": 3, "\\r": 5, "\\"": 7, "\\\\": 8}\n',
    );
  });

  it("compares immutable collections structurally without an identity shortcut", () => {
    expectOutput(
      main(`출력([1, 2] == [1, 2])
출력([1, 2] != [2, 1])
출력({"가": 1, "나": 2} == {"나": 2, "가": 1})
출력(일부([1]) == 일부([1]))
상수 무효 = 0.0 / 0.0
상수 값 = [무효]
출력(값 == 값)
상수 사전값 = {"무효": 무효}
출력(사전값 == 사전값)`),
      "참\n참\n참\n참\n거짓\n거짓\n",
    );
  });

  it("implements explicit conversions with truncation and nearest-even integer rounding", () => {
    expectOutput(
      main(`출력(정수로(3.9))
출력(정수로(-3.9))
출력(정수로(-9223372036854775808.0))
출력(실수로(9007199254740993))
출력(실수로(9007199254740995))`),
      "3\n-3\n-9223372036854775808\n9007199254740992.0\n9007199254740996.0\n",
    );
  });

  it.each([
    "정수로(0.0 / 0.0)",
    "정수로(1.0 / 0.0)",
    "정수로(9223372036854775808.0)",
    "정수로(-9223372036854777856.0)",
  ])("rejects the runtime conversion %s", (expression) => {
    const result = execute(main(`출력(${expression})`));
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("GE4003");
    expect(result.stderr).toContain(`${fixturePath}:2:8`);
  });

  it("short-circuits logical and optional operations without evaluating the right side", () => {
    expectOutput(
      `함수 실패() -> 정수 { 반환 1 / 0 }
함수 표시(값: 불리언) -> 불리언 { 출력("생략 실패"); 반환 값 }
함수 대안() -> 정수 { 출력("대안"); 반환 5 }
함수 시작() -> 없음 {
    출력(거짓 그리고 표시(참))
    출력(참 또는 표시(거짓))
    상수 값: 선택[정수] = 일부(4)
    출력(값 ?? 실패())
    상수 빈값: 선택[정수] = 비어있음
    출력(빈값 ?? 대안())
}`,
      "거짓\n참\n4\n대안\n5\n",
    );
  });

  it("evaluates operands, arguments, list items, and dictionary values in source order", () => {
    expectOutput(
      `함수 표시(값: 정수) -> 정수 { 출력(값); 반환 값 }
함수 더하기(가: 정수, 나: 정수) -> 정수 { 반환 가 + 나 }
함수 시작() -> 없음 {
    출력(표시(1) + 표시(2))
    출력(더하기(표시(3), 표시(4)))
    출력([표시(5), 표시(6)])
    출력({"나": 표시(7), "가": 표시(8)})
}`,
      '1\n2\n3\n3\n4\n7\n5\n6\n[5, 6]\n7\n8\n{"가": 8, "나": 7}\n',
    );
  });

  it("provides a source map and preserves original source content", () => {
    const source = main('출력("GEULION")');
    const output = compile(source);
    expect(output.sourceMap).toMatchObject({
      version: 3,
      sources: [fixturePath],
      sourcesContent: [source],
    });
    expect(output.sourceMap.mappings.length).toBeGreaterThan(0);
    expect(output.mappings.length).toBeGreaterThan(0);
    expect(output.code).not.toContain("function 시작(");
    expect(output.code).toContain("sourceMappingURL=");
    const sourceMap = new SourceMap({
      ...output.sourceMap,
      sources: [...output.sourceMap.sources],
      sourcesContent: output.sourceMap.sourcesContent.map((content) => content ?? ""),
      names: [...output.sourceMap.names],
      sourceRoot: "",
    });
    for (const mapping of output.mappings) {
      expect(sourceMap.findEntry(mapping.generatedLine - 1, mapping.generatedColumn)).toMatchObject(
        {
          originalLine: mapping.source.start.line - 1,
          originalColumn: mapping.source.start.column - 1,
        },
      );
    }
  });
});
