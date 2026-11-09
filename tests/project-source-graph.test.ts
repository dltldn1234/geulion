import { describe, expect, it } from "vitest";
import { loadProjectSourceGraph, type ProjectSourceInput } from "@geulion/compiler";

function input(
  entryPath: string,
  files: readonly (readonly [string, string])[],
): ProjectSourceInput {
  return {
    entryPath,
    rootPath: "/virtual/project",
    languageVersion: "0.4",
    sources: new Map(files.map(([path, text]) => [path, new TextEncoder().encode(text)])),
  };
}

describe("v0.4 project source graph", () => {
  it("loads only the reachable closure and sorts modules by canonical path", () => {
    const result = loadProjectSourceGraph(
      input("app/main.geul", [
        ["unused/broken.geul", "\u0000"],
        ["lib/math.geul", "공개 함수 더하기(가: 정수, 나: 정수) -> 정수 { 반환 가 + 나 }"],
        [
          "app/main.geul",
          `가져오기 "../lib/./math.geul" 별칭 수학
함수 시작() -> 없음 { 출력(수학.더하기(1, 2)) }`,
        ],
      ]),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.graph.rootPath).toBe("/virtual/project");
    expect(result.graph.entryPath).toBe("app/main.geul");
    expect(result.graph.modules.map(({ path }) => path)).toEqual([
      "app/main.geul",
      "lib/math.geul",
    ]);
    expect(result.graph.modules[0]?.ast.imports[0]?.path).toBe("../lib/./math.geul");
  });

  it("loads a cyclic graph once without recursion", () => {
    const result = loadProjectSourceGraph(
      input("main.geul", [
        ["main.geul", '가져오기 "./lib.geul" 별칭 라이브러리\n함수 시작() -> 없음 {}'],
        ["lib.geul", '가져오기 "./main.geul" 별칭 진입\n공개 함수 도움() -> 없음 {}'],
      ]),
    );

    expect(result.success).toBe(true);
    if (result.success)
      expect(result.graph.modules.map(({ path }) => path)).toEqual(["lib.geul", "main.geul"]);
  });

  it.each([
    ["/absolute.geul", "GE2006"],
    ["C:/drive.geul", "GE2006"],
    ["https://example.test/lib.geul", "GE2006"],
    ["./lib.txt", "GE2006"],
    ["./dir\\lib.geul", "GE2006"],
  ])("rejects an invalid import path %s", (importPath, code) => {
    const escapedImportPath = importPath.replaceAll("\\", "\\\\");
    const result = loadProjectSourceGraph(
      input("main.geul", [
        ["main.geul", `가져오기 "${escapedImportPath}" 별칭 모듈\n함수 시작() -> 없음 {}`],
      ]),
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.diagnostics[0]).toMatchObject({
        code,
        phase: "resolve",
        path: "main.geul",
        range: { start: { line: 1 } },
      });
  });

  it("rejects paths that escape the project root", () => {
    const result = loadProjectSourceGraph(
      input("main.geul", [
        ["main.geul", '가져오기 "../outside.geul" 별칭 바깥\n함수 시작() -> 없음 {}'],
      ]),
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.diagnostics[0]).toMatchObject({ code: "GE2007", path: "main.geul" });
  });

  it("reports missing modules at the import path", () => {
    const result = loadProjectSourceGraph(
      input("main.geul", [
        ["main.geul", '가져오기 "./missing.geul" 별칭 누락\n함수 시작() -> 없음 {}'],
      ]),
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.diagnostics[0]).toMatchObject({
        code: "GE2006",
        path: "main.geul",
        range: { start: { line: 1 }, end: { line: 1 } },
      });
  });

  it("rejects duplicate canonical imports and duplicate aliases", () => {
    const duplicatePath = loadProjectSourceGraph(
      input("main.geul", [
        [
          "main.geul",
          `가져오기 "./lib.geul" 별칭 첫째
가져오기 "././lib.geul" 별칭 둘째
함수 시작() -> 없음 {}`,
        ],
        ["lib.geul", "공개 함수 값() -> 정수 { 반환 1 }"],
      ]),
    );
    expect(duplicatePath.success).toBe(false);
    if (!duplicatePath.success)
      expect(duplicatePath.diagnostics.map(({ code }) => code)).toContain("GE2008");

    const duplicateAlias = loadProjectSourceGraph(
      input("main.geul", [
        [
          "main.geul",
          `가져오기 "./first.geul" 별칭 도구
가져오기 "./second.geul" 별칭 도구
함수 시작() -> 없음 {}`,
        ],
        ["first.geul", "공개 함수 값() -> 정수 { 반환 1 }"],
        ["second.geul", "공개 함수 값() -> 정수 { 반환 2 }"],
      ]),
    );
    expect(duplicateAlias.success).toBe(false);
    if (!duplicateAlias.success)
      expect(duplicateAlias.diagnostics.map(({ code }) => code)).toContain("GE2008");
  });

  it("returns deterministic modules and diagnostics regardless of map insertion order", () => {
    const main = `가져오기 "./z.geul" 별칭 지
가져오기 "./a.geul" 별칭 가\n함수 시작() -> 없음 {}`;
    const files = [
      ["main.geul", main],
      ["z.geul", "공개 함수 값() -> 정수 { 반환 1 }"],
      ["a.geul", "공개 함수 값() -> 정수 { 반환 2 }"],
    ] as const;
    const first = loadProjectSourceGraph(input("main.geul", files));
    const second = loadProjectSourceGraph(input("main.geul", [...files].reverse()));

    expect(first).toEqual(second);
  });

  it("reports missing entry sources and non-canonical entry paths", () => {
    const missing = loadProjectSourceGraph(input("main.geul", []));
    expect(missing.success).toBe(false);
    if (!missing.success)
      expect(missing.diagnostics[0]).toMatchObject({
        code: "GE2006",
        path: "main.geul",
        range: null,
      });

    const nonCanonical = loadProjectSourceGraph(input("./main.geul", []));
    expect(nonCanonical.success).toBe(false);
    if (!nonCanonical.success)
      expect(nonCanonical.diagnostics[0]).toMatchObject({ code: "GE2006", path: "./main.geul" });
  });
});
