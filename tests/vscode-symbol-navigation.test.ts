import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

interface Position {
  line: number;
  character: number;
}

interface Range {
  start: Position;
  end: Position;
}

interface DefinitionProvider {
  provideDefinition(
    document: { uri: { fsPath: string }; getText(): string; offsetAt(position: Position): number },
    position: Position,
  ): Promise<{ uri: { fsPath: string }; range: Range } | undefined>;
}

interface DocumentSymbolProvider {
  provideDocumentSymbols(document: { uri: { fsPath: string }; getText(): string }): Promise<
    {
      name: string;
      detail: string;
      range: Range;
      selectionRange: Range;
    }[]
  >;
}

const extension = createRequire(import.meta.url)("../packages/vscode/extension.js") as {
  activate(context: unknown, vscode: unknown, spawn: unknown): void;
};

class FakePosition implements Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

class FakeRange implements Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}

class FakeLocation {
  constructor(
    readonly uri: { fsPath: string },
    readonly range: Range,
  ) {}
}

class FakeDocumentSymbol {
  constructor(
    readonly name: string,
    readonly detail: string,
    readonly kind: number,
    readonly range: Range,
    readonly selectionRange: Range,
  ) {}
}

function createProviders(version: "0.1" | "0.2" | "0.3" = "0.1") {
  let definition: DefinitionProvider | undefined;
  let symbols: DocumentSymbolProvider | undefined;
  const vscode = {
    commands: { registerCommand: () => ({ dispose() {} }) },
    window: {
      createOutputChannel: () => ({
        clear() {},
        append() {},
        appendLine() {},
        show() {},
        dispose() {},
      }),
      showErrorMessage() {},
    },
    workspace: {
      getConfiguration: () => ({
        get: (_key: string, fallback: unknown) => (_key === "languageVersion" ? version : fallback),
      }),
    },
    languages: {
      registerDefinitionProvider: (_selector: string, provider: DefinitionProvider) => {
        definition = provider;
        return { dispose() {} };
      },
      registerDocumentSymbolProvider: (_selector: string, provider: DocumentSymbolProvider) => {
        symbols = provider;
        return { dispose() {} };
      },
    },
    Position: FakePosition,
    Range: FakeRange,
    Location: FakeLocation,
    DocumentSymbol: FakeDocumentSymbol,
    SymbolKind: { Function: 11 },
  };
  extension.activate({ subscriptions: [] }, vscode, (() => {}) as never);
  if (!definition || !symbols)
    throw new Error("GEULION source navigation providers were not registered");
  return { definition, symbols };
}

function documentFor(source: string) {
  return {
    uri: { fsPath: "/workspace/main.geul" },
    getText: () => source,
    offsetAt(position: Position) {
      return (
        source
          .split("\n")
          .slice(0, position.line)
          .reduce((length, line) => length + line.length + 1, 0) + position.character
      );
    },
  };
}

function positionOf(source: string, line: number, token: string): Position {
  const sourceLine = source.split("\n")[line] ?? "";
  const character = sourceLine.indexOf(token);
  if (character < 0) throw new Error(`Missing ${token} on line ${line}`);
  return { line, character };
}

describe("GEULION VS Code source navigation", () => {
  it("resolves a function call to its declaration using the active document text", async () => {
    const source = [
      "함수 합계(값: 정수) -> 정수 { 반환 값 }",
      "함수 시작() -> 없음 {",
      "    상수 결과: 정수 = 합계(1)",
      "    출력(결과)",
      "}",
    ].join("\n");
    const { definition } = createProviders();
    const location = await definition.provideDefinition(
      documentFor(source),
      positionOf(source, 2, "합계"),
    );
    expect(location?.uri.fsPath).toBe("/workspace/main.geul");
    expect(location?.range).toEqual(new FakeRange(new FakePosition(0, 3), new FakePosition(0, 5)));
  });

  it("resolves shadowed local values to their nearest declaration", async () => {
    const source = [
      "함수 시작() -> 없음 {",
      "    변수 값: 정수 = 1",
      "    만약 참 {",
      "        변수 값: 정수 = 2",
      "        출력(값)",
      "    }",
      "    출력(값)",
      "}",
    ].join("\n");
    const { definition } = createProviders();
    const inner = await definition.provideDefinition(
      documentFor(source),
      positionOf(source, 4, "값"),
    );
    const outer = await definition.provideDefinition(
      documentFor(source),
      positionOf(source, 6, "값"),
    );
    expect(inner?.range.start).toEqual(new FakePosition(3, 11));
    expect(outer?.range.start).toEqual(new FakePosition(1, 7));
  });

  it("keeps declaration positions correct after supplementary Unicode characters", async () => {
    const source = [
      "함수 봄() -> 정수 { 반환 1 }",
      "함수 시작() -> 없음 {",
      "    /* 🌱 */ 출력(봄())",
      "}",
    ].join("\n");
    const { definition } = createProviders();
    const location = await definition.provideDefinition(
      documentFor(source),
      positionOf(source, 2, "봄"),
    );
    expect(location?.range.start).toEqual(new FakePosition(0, 3));
  });

  it("does not invent definitions for prelude functions or malformed source", async () => {
    const { definition } = createProviders();
    const valid = "함수 시작() -> 없음 { 출력(1) }";
    expect(
      await definition.provideDefinition(documentFor(valid), positionOf(valid, 0, "출력")),
    ).toBeUndefined();

    const malformed = "함수 시작(";
    expect(
      await definition.provideDefinition(documentFor(malformed), { line: 0, character: 6 }),
    ).toBeUndefined();
  });

  it("lists functions in source order with visibility, signature, and ranges", async () => {
    const source = [
      "공개 함수 합계(값: 목록[정수]) -> 정수 { 반환 1 }",
      "함수 시작() -> 없음 {}",
    ].join("\n");
    const { symbols } = createProviders("0.3");
    const result = await symbols.provideDocumentSymbols(documentFor(source));
    expect(result.map(({ name }) => name)).toEqual(["합계", "시작"]);
    expect(result[0]?.detail).toBe("공개 함수 합계(값: 목록[정수]) -> 정수");
    expect(result[0]?.selectionRange.start).toEqual(new FakePosition(0, 6));
    expect(result[1]?.range.start).toEqual(new FakePosition(1, 0));
  });
});
