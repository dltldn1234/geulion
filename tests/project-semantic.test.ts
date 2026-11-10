import { describe, expect, it } from "vitest";
import {
  analyzeProjectSourceGraph,
  loadProjectSourceGraph,
  type ProjectSourceGraph,
} from "@geulion/compiler";

function project(files: readonly (readonly [string, string])[]): ProjectSourceGraph {
  const result = loadProjectSourceGraph({
    entryPath: "app.geul",
    rootPath: "/virtual/project",
    languageVersion: "0.4",
    sources: new Map(files.map(([path, text]) => [path, new TextEncoder().encode(text)])),
  });
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  return result.graph;
}

describe("v0.4 project semantic analysis", () => {
  it("collects signatures before checking mutually recursive modules", () => {
    const graph = project([
      [
        "app.geul",
        `가져오기 "./lib.geul" 별칭 도구
공개 함수 짝수(값: 정수) -> 불리언 { 반환 도구.홀수(값 - 1) }
함수 시작() -> 없음 { 출력(짝수(4)) }`,
      ],
      [
        "lib.geul",
        `가져오기 "./app.geul" 별칭 앱
공개 함수 홀수(값: 정수) -> 불리언 { 만약 값 == 0 { 반환 거짓 }
반환 앱.짝수(값 - 1) }`,
      ],
    ]);

    const result = analyzeProjectSourceGraph(graph);
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.modules.map(({ path }) => path)).toEqual(["app.geul", "lib.geul"]);
  });

  it("type-checks arguments of qualified public calls", () => {
    const graph = project([
      [
        "app.geul",
        `가져오기 "./lib.geul" 별칭 도구
함수 시작() -> 없음 { 출력(도구.더하기("문자열", 1)) }`,
      ],
      ["lib.geul", "공개 함수 더하기(가: 정수, 나: 정수) -> 정수 { 반환 가 + 나 }"],
    ]);

    const result = analyzeProjectSourceGraph(graph);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ phase: "type" }));
  });

  it("resolves NFC-equivalent exported names", () => {
    const graph = project([
      [
        "app.geul",
        `가져오기 "./lib.geul" 별칭 도구
함수 시작() -> 없음 { 출력(도구.가()) }`,
      ],
      ["lib.geul", "공개 함수 가() -> 정수 { 반환 1 }"],
    ]);

    expect(analyzeProjectSourceGraph(graph).success).toBe(true);
  });

  it.each([
    [
      `가져오기 "./lib.geul" 별칭 도구
함수 시작() -> 없음 { 출력(없는.값()) }`,
      "GE2009",
    ],
    [
      `가져오기 "./lib.geul" 별칭 도구
함수 시작() -> 없음 { 출력(도구.숨김()) }`,
      "GE2009",
    ],
    [
      `가져오기 "./lib.geul" 별칭 출력
함수 시작() -> 없음 { 출력(1) }`,
      "GE2008",
    ],
  ])("reports module resolution errors for %s", (source, code) => {
    const graph = project([
      ["app.geul", source],
      ["lib.geul", "함수 숨김() -> 정수 { 반환 1 }"],
    ]);
    const result = analyzeProjectSourceGraph(graph);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.diagnostics.map(({ code: actual }) => actual)).toContain(code);
  });

  it("keeps imported functions out of unqualified lookup", () => {
    const graph = project([
      [
        "app.geul",
        `가져오기 "./lib.geul" 별칭 도구
함수 시작() -> 없음 { 출력(값()) }`,
      ],
      ["lib.geul", "공개 함수 값() -> 정수 { 반환 1 }"],
    ]);

    const result = analyzeProjectSourceGraph(graph);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.diagnostics.map(({ code }) => code)).toContain("GE2001");
  });

  it("reports an import alias colliding with a local function", () => {
    const graph = project([
      [
        "app.geul",
        `가져오기 "./lib.geul" 별칭 도구
함수 도구() -> 정수 { 반환 1 }
함수 시작() -> 없음 { 출력(도구.값()) }`,
      ],
      ["lib.geul", "공개 함수 값() -> 정수 { 반환 1 }"],
    ]);

    const result = analyzeProjectSourceGraph(graph);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.diagnostics.map(({ code }) => code)).toContain("GE2008");
  });

  it("requires one private entrypoint and forbids it in imported modules", () => {
    const missingEntry = project([["app.geul", "공개 함수 값() -> 정수 { 반환 1 }"]]);
    const missingResult = analyzeProjectSourceGraph(missingEntry);
    expect(missingResult.success).toBe(false);
    if (!missingResult.success)
      expect(missingResult.diagnostics.map(({ code }) => code)).toContain("GE2010");

    const importedEntry = project([
      ["app.geul", '가져오기 "./lib.geul" 별칭 도구\n함수 시작() -> 없음 {}'],
      ["lib.geul", "함수 시작() -> 없음 {}"],
    ]);
    const importedResult = analyzeProjectSourceGraph(importedEntry);
    expect(importedResult.success).toBe(false);
    if (!importedResult.success)
      expect(
        importedResult.diagnostics.some(
          ({ code, path }) => code === "GE2010" && path === "lib.geul",
        ),
      ).toBe(true);

    const publicEntry = project([[
      "app.geul",
      "공개 함수 시작() -> 정수 { 반환 1 }",
    ]]);
    const publicEntryResult = analyzeProjectSourceGraph(publicEntry);
    expect(publicEntryResult.success).toBe(false);
    if (!publicEntryResult.success)
      expect(publicEntryResult.diagnostics.map(({ code }) => code)).toContain("GE2010");
  });

  it("returns the same diagnostics when source map enumeration order changes", () => {
    const files = [
      [
        "app.geul",
        '가져오기 "./lib.geul" 별칭 도구\n함수 시작() -> 없음 { 출력(도구.값("잘못된 값")) }',
      ],
      ["lib.geul", "공개 함수 값(값: 정수) -> 정수 { 반환 값 }"],
    ] as const;
    const first = analyzeProjectSourceGraph(project(files));
    const second = analyzeProjectSourceGraph(project([...files].reverse()));
    expect(first).toEqual(second);
  });

  it("reports NFC-equivalent duplicate import aliases", () => {
    const result = loadProjectSourceGraph({
      entryPath: "app.geul",
      rootPath: "/virtual/project",
      languageVersion: "0.4",
      sources: new Map([
        [
          "app.geul",
          new TextEncoder().encode(
            `가져오기 "./one.geul" 별칭 가\n가져오기 "./two.geul" 별칭 가\n함수 시작() -> 없음 {}`,
          ),
        ],
        ["one.geul", new TextEncoder().encode("공개 함수 값() -> 정수 { 반환 1 }")],
        ["two.geul", new TextEncoder().encode("공개 함수 값() -> 정수 { 반환 2 }")],
      ]),
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.diagnostics.map(({ code }) => code)).toContain("GE2008");
  });
});
