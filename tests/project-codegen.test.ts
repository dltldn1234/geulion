import { spawnSync } from "node:child_process";
import { SourceMap } from "node:module";
import { describe, expect, it } from "vitest";
import { compileProjectSourceGraph, loadProjectSourceGraph } from "@geulion/compiler";

function graph(files: readonly (readonly [string, string])[]) {
  const result = loadProjectSourceGraph({
    entryPath: "app.geul",
    rootPath: "/virtual/project",
    languageVersion: "0.4",
    sources: new Map(files.map(([path, text]) => [path, new TextEncoder().encode(text)])),
  });
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  return result.graph;
}

describe("v0.4 project JavaScript generation", () => {
  it("emits globally unique functions and executes the entrypoint once", () => {
    const sourceGraph = graph([
      [
        "app.geul",
        `가져오기 "./lib.geul" 별칭 도구
함수 도움() -> 정수 { 반환 3 }
함수 시작() -> 없음 { 출력(도구.계산()); 출력(도움()) }`,
      ],
      [
        "lib.geul",
        `함수 도움() -> 정수 { 반환 4 }
공개 함수 계산() -> 정수 { 반환 도움() }`,
      ],
    ]);

    const compiled = compileProjectSourceGraph(sourceGraph);
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;

    const executed = spawnSync(process.execPath, ["--input-type=module", "-"], {
      input: compiled.code,
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(executed.error).toBeUndefined();
    expect(executed.status, executed.stderr).toBe(0);
    expect(executed.stdout).toBe("4\n3\n");
    expect(executed.stderr).toBe("");
  });

  it("maps generated code and runtime failures to their originating module", () => {
    const sourceGraph = graph([
      [
        "app.geul",
        `가져오기 "./lib.geul" 별칭 도구
함수 시작() -> 없음 { 출력(도구.나누기(8, 0)) }`,
      ],
      ["lib.geul", "공개 함수 나누기(가: 정수, 나: 정수) -> 정수 { 반환 가 / 나 }"],
    ]);
    const compiled = compileProjectSourceGraph(sourceGraph);
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;

    expect(compiled.sourceMap.sources).toEqual(["app.geul", "lib.geul"]);
    expect(compiled.sourceMap.sourcesContent).toEqual([
      `가져오기 "./lib.geul" 별칭 도구
함수 시작() -> 없음 { 출력(도구.나누기(8, 0)) }`,
      "공개 함수 나누기(가: 정수, 나: 정수) -> 정수 { 반환 가 / 나 }",
    ]);
    expect(compiled.mappings.some(({ sourcePath }) => sourcePath === "lib.geul")).toBe(true);
    const sourceMap = new SourceMap({
      ...compiled.sourceMap,
      sources: [...compiled.sourceMap.sources],
      sourcesContent: compiled.sourceMap.sourcesContent.map((content) => content ?? ""),
      names: [...compiled.sourceMap.names],
      sourceRoot: "",
    });
    const libraryMapping = compiled.mappings.find(({ sourcePath }) => sourcePath === "lib.geul");
    expect(libraryMapping).toBeDefined();
    if (!libraryMapping) return;
    expect(
      sourceMap.findEntry(libraryMapping.generatedLine - 1, libraryMapping.generatedColumn),
    ).toMatchObject({ originalSource: "lib.geul" });

    const executed = spawnSync(process.execPath, ["--input-type=module", "-"], {
      input: compiled.code,
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(executed.status).not.toBe(0);
    expect(executed.stderr).toContain("lib.geul:1:");
    expect(executed.stderr).toContain("나누기(가: 정수, 나: 정수)");
  });

  it("keeps browser bundles inert and exposes only entry-module exports", async () => {
    const sourceGraph = graph([
      [
        "app.geul",
        `가져오기 "./lib.geul" 별칭 도구
공개 함수 결과() -> 정수 { 반환 도구.값() }`,
      ],
      ["lib.geul", "공개 함수 값() -> 정수 { 반환 7 }"],
    ]);
    const compiled = compileProjectSourceGraph(sourceGraph, "browser");
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    expect(compiled.code).not.toMatch(/\b(?:process|window|document)\b/u);
    expect(compiled.code).not.toContain('from "node:fs"');

    const imported = await import(
      `data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`
    );
    const moduleResult = imported.createModule({ write() {} });
    expect(moduleResult.kind).toBe("module");
    if (moduleResult.kind !== "module") return;
    expect(moduleResult.module.exports.map(({ name }: { name: string }) => name)).toEqual(["결과"]);
    expect(moduleResult.module.invoke("결과", [])).toMatchObject({
      kind: "value",
      value: { kind: "integer", decimal: "7" },
    });
  });

  it("returns target-specific entrypoint diagnostics before generation", () => {
    const sourceGraph = graph([["app.geul", "함수 값() -> 정수 { 반환 1 }"]]);
    const nodeResult = compileProjectSourceGraph(sourceGraph, "node");
    const browserResult = compileProjectSourceGraph(sourceGraph, "browser");
    expect(nodeResult.success).toBe(false);
    expect(browserResult.success).toBe(false);
    if (!browserResult.success)
      expect(browserResult.diagnostics.map(({ code }) => code)).toContain("GE2005");
  });
});
