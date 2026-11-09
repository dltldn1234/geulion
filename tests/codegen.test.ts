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

function compileBrowser(source: string) {
  const parsed = parseSource({ path: fixturePath, source: new TextEncoder().encode(source) });
  if (!parsed.success)
    throw new Error(`Invalid browser syntax fixture: ${parsed.diagnostics[0]?.message}`);
  const analyzed = analyzeProgram(parsed.ast, fixturePath, "0.3");
  if (!analyzed.success)
    throw new Error(`Invalid browser semantic fixture: ${analyzed.diagnostics[0]?.message}`);
  return generateJavaScript(analyzed.program, { sourceText: source, target: "browser" });
}

function executeBrowser(source: string, script: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `${compileBrowser(source).code}\n${script}`,
    encoding: "utf8",
    timeout: 5_000,
  });
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

describe("v0.3 browser modules and invocation ABI", () => {
  it("publishes only public signatures and never runs 시작 during module creation", () => {
    const result = executeBrowser(
      `공개 함수 더하기(가: 정수, 나: 정수) -> 정수 { 반환 가 + 나 }
함수 비공개() -> 없음 { 출력("내부") }
함수 시작() -> 없음 { 출력("자동 실행 금지") }`,
      `const writes = [];
const created = createModule({ write(text) { writes.push(text); } });
const module_ = created.module;
const result = module_.invoke("더하기", [
  { kind: "integer", decimal: "20" }, { kind: "integer", decimal: "22" }
]);
console.log(JSON.stringify({
  created: created.kind,
  apiVersion: module_.apiVersion,
  exports: module_.exports,
  result,
  privateCall: module_.invoke("비공개", []),
  startCall: module_.invoke("시작", []),
  writes
}));`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      created: string;
      apiVersion: number;
      exports: readonly { name: string; parameters: readonly unknown[]; returns: unknown }[];
      result: unknown;
      privateCall: unknown;
      startCall: unknown;
      writes: readonly string[];
    };
    expect(parsed).toMatchObject({
      created: "module",
      apiVersion: 1,
      exports: [
        {
          name: "더하기",
          parameters: [
            { kind: "primitive", name: "정수" },
            { kind: "primitive", name: "정수" },
          ],
          returns: { kind: "primitive", name: "정수" },
        },
      ],
      result: { kind: "value", value: { kind: "integer", decimal: "42" } },
      privateCall: { kind: "host-error", error: { code: "unknown-export", name: "비공개" } },
      startCall: { kind: "host-error", error: { code: "unknown-export", name: "시작" } },
      writes: [],
    });
    expect(result.stderr).toBe("");
  });

  it("rejects invalid tagged values and reports source runtime diagnostics", () => {
    const result = executeBrowser(
      `공개 함수 나누기(가: 정수, 나: 정수) -> 정수 { 반환 가 / 나 }
함수 시작() -> 없음 {}`,
      `const module_ = createModule({ write() {} }).module;
let sideEffects = 0;
const accessor = { kind: "integer" };
Object.defineProperty(accessor, "decimal", { enumerable: true, get() { sideEffects += 1; return "1"; } });
const custom = { kind: "integer", decimal: "1", toJSON() { sideEffects += 1; return this; } };
const output = [
  module_.invoke("나누기", [{kind:"integer",decimal:"01"},{kind:"integer",decimal:"1"}]),
  module_.invoke("나누기", [{kind:"integer",decimal:"1",extra:true},{kind:"integer",decimal:"1"}]),
  module_.invoke("나누기", [accessor,{kind:"integer",decimal:"1"}]),
  module_.invoke("나누기", [custom,{kind:"integer",decimal:"1"}]),
  module_.invoke("나누기", [{kind:"integer",decimal:"1"},{kind:"integer",decimal:"0"}]),
  module_.invoke("없는 함수", []),
  module_.invoke("나누기", [{kind:"integer",decimal:"1"}])
];
console.log(JSON.stringify({ output, sideEffects }));`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      output: [
        { kind: "host-error", error: { code: "argument-mismatch", name: "나누기" } },
        { kind: "host-error", error: { code: "argument-mismatch", name: "나누기" } },
        { kind: "host-error", error: { code: "argument-mismatch", name: "나누기" } },
        { kind: "host-error", error: { code: "argument-mismatch", name: "나누기" } },
        { kind: "diagnostic", diagnostic: { code: "GE4002", phase: "runtime", path: fixturePath } },
        { kind: "host-error", error: { code: "unknown-export", name: "없는 함수" } },
        { kind: "host-error", error: { code: "argument-mismatch", name: "나누기" } },
      ],
      sideEffects: 0,
    });
  });

  it("validates the host and turns host.write failures into GE4004", () => {
    const result = executeBrowser(
      `공개 함수 알림() -> 없음 { 출력("호스트") }
함수 시작() -> 없음 {}`,
      `const invalid = createModule(null);
const module_ = createModule({ write() { throw new Error("broken host"); } }).module;
console.log(JSON.stringify({ invalid, output: module_.invoke("알림", []) }));`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      invalid: { kind: "host-error", error: { code: "invalid-host" } },
      output: { kind: "diagnostic", diagnostic: { code: "GE4004", phase: "runtime" } },
    });
  });

  it("round-trips recursively tagged collection and optional values", () => {
    const result = executeBrowser(
      `공개 함수 그대로(값: 목록[선택[정수]]) -> 목록[선택[정수]] { 반환 값 }
함수 시작() -> 없음 {}`,
      `const module_ = createModule({ write() {} }).module;
const value = {kind:"list",values:[{kind:"some",value:{kind:"integer",decimal:"-2"}},{kind:"none"}]};
console.log(JSON.stringify(module_.invoke("그대로", [value])));`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      kind: "value",
      value: {
        kind: "list",
        values: [{ kind: "some", value: { kind: "integer", decimal: "-2" } }, { kind: "none" }],
      },
    });
  });

  it("enforces canonical real, scalar string, collection, and recursive-depth limits", () => {
    const realAndText = executeBrowser(
      `공개 함수 실수값(값: 실수) -> 실수 { 반환 값 }
공개 함수 문자열값(값: 문자열) -> 문자열 { 반환 값 }
공개 함수 목록값(값: 목록[없음]) -> 목록[없음] { 반환 값 }
함수 시작() -> 없음 {}`,
      `const module_ = createModule({ write() {} }).module;
const results = [
  module_.invoke("실수값", [{kind:"real",value:"1.0"}]),
  module_.invoke("실수값", [{kind:"real",value:"-0"}]),
  module_.invoke("문자열값", [{kind:"string",value:"\\ud800"}]),
  module_.invoke("문자열값", [{kind:"string",value:"x".repeat(262145)}]),
  module_.invoke("목록값", [{kind:"list",values:Array(16385).fill({kind:"unit"})}])
];
console.log(JSON.stringify(results));`,
    );
    expect(realAndText.error).toBeUndefined();
    expect(realAndText.status, realAndText.stderr).toBe(0);
    expect(JSON.parse(realAndText.stdout)).toMatchObject([
      { kind: "host-error", error: { code: "argument-mismatch", name: "실수값" } },
      { kind: "value", value: { kind: "real", value: "-0" } },
      { kind: "host-error", error: { code: "argument-mismatch", name: "문자열값" } },
      { kind: "host-error", error: { code: "argument-mismatch", name: "문자열값" } },
      { kind: "host-error", error: { code: "argument-mismatch", name: "목록값" } },
    ]);

    let nestedType = "정수";
    let nestedValue: unknown = { kind: "integer", decimal: "1" };
    for (let depth = 0; depth < 65; depth += 1) {
      nestedType = `선택[${nestedType}]`;
      nestedValue = { kind: "some", value: nestedValue };
    }
    const deep = executeBrowser(
      `공개 함수 깊이(값: ${nestedType}) -> ${nestedType} { 반환 값 }
함수 시작() -> 없음 {}`,
      `const module_ = createModule({ write() {} }).module;
console.log(JSON.stringify(module_.invoke("깊이", [${JSON.stringify(nestedValue)}])));`,
    );
    expect(deep.error).toBeUndefined();
    expect(deep.status, deep.stderr).toBe(0);
    expect(JSON.parse(deep.stdout)).toEqual({
      kind: "host-error",
      error: { code: "argument-mismatch", name: "깊이" },
    });
  });

  it("accepts collection limits at the boundary and rejects oversized encoded arguments", () => {
    const result = executeBrowser(
      `공개 함수 목록값(값: 목록[없음]) -> 목록[없음] { 반환 값 }
공개 함수 문자열목록(값: 목록[문자열]) -> 목록[문자열] { 반환 값 }
함수 시작() -> 없음 {}`,
      `const module_ = createModule({ write() {} }).module;
const atLimit = module_.invoke("목록값", [{kind:"list",values:Array(16384).fill({kind:"unit"})}]);
const tooLarge = module_.invoke("문자열목록", [{kind:"list",values:Array(4000).fill({kind:"string",value:"x".repeat(250)})}]);
console.log(JSON.stringify({ atLimit: [atLimit.kind, atLimit.value?.values.length], tooLarge }));`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      atLimit: ["value", 16384],
      tooLarge: { kind: "host-error", error: { code: "argument-mismatch", name: "문자열목록" } },
    });
  });
});
