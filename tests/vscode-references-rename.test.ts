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

interface Location {
  uri: { fsPath: string };
  range: Range;
}

interface ReferenceProvider {
  provideReferences(
    document: { uri: { fsPath: string }; getText(): string; offsetAt(position: Position): number },
    position: Position,
    context: { includeDeclaration: boolean },
  ): Promise<Location[]>;
}

interface RenameProvider {
  prepareRename(
    document: { uri: { fsPath: string }; getText(): string; offsetAt(position: Position): number },
    position: Position,
  ): Promise<{ range: Range; placeholder: string } | undefined>;
  provideRenameEdits(
    document: { uri: { fsPath: string }; getText(): string; offsetAt(position: Position): number },
    position: Position,
    newName: string,
  ): Promise<FakeWorkspaceEdit | undefined>;
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

class FakeLocation implements Location {
  constructor(
    readonly uri: { fsPath: string },
    readonly range: Range,
  ) {}
}

class FakeWorkspaceEdit {
  readonly replacements: { uri: { fsPath: string }; range: Range; newText: string }[] = [];

  replace(uri: { fsPath: string }, range: Range, newText: string) {
    this.replacements.push({ uri, range, newText });
  }
}

function createProviders(version: "0.1" | "0.2" | "0.3" = "0.1") {
  let references: ReferenceProvider | undefined;
  let rename: RenameProvider | undefined;
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
      registerReferenceProvider: (_selector: string, provider: ReferenceProvider) => {
        references = provider;
        return { dispose() {} };
      },
      registerRenameProvider: (_selector: string, provider: RenameProvider) => {
        rename = provider;
        return { dispose() {} };
      },
    },
    Position: FakePosition,
    Range: FakeRange,
    Location: FakeLocation,
    WorkspaceEdit: FakeWorkspaceEdit,
  };
  extension.activate({ subscriptions: [] }, vscode, (() => {}) as never);
  if (!references || !rename)
    throw new Error("GEULION reference and rename providers were not registered");
  return { references, rename };
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

describe("GEULION VS Code references and rename", () => {
  it("returns only semantic references and honors declaration inclusion", async () => {
    const source = [
      "함수 합계(값: 정수) -> 정수 { 반환 값 }",
      "함수 시작() -> 없음 {",
      "    출력(합계(1))",
      "}",
    ].join("\n");
    const { references } = createProviders();
    const document = documentFor(source);
    const position = positionOf(source, 2, "합계");
    const uses = await references.provideReferences(document, position, {
      includeDeclaration: false,
    });
    const all = await references.provideReferences(document, position, {
      includeDeclaration: true,
    });
    expect(uses).toHaveLength(1);
    expect(uses[0]?.range.start).toEqual(new FakePosition(2, 7));
    expect(all).toHaveLength(2);
    expect(all.map((location) => location.range.start)).toContainEqual(new FakePosition(0, 3));
  });

  it("renames a function declaration and its call sites", async () => {
    const source = [
      "함수 합계(값: 정수) -> 정수 { 반환 값 }",
      "함수 시작() -> 없음 {",
      "    출력(합계(1))",
      "}",
    ].join("\n");
    const { rename } = createProviders();
    const document = documentFor(source);
    const position = positionOf(source, 2, "합계");
    expect(await rename.prepareRename(document, position)).toMatchObject({ placeholder: "합계" });
    const edit = await rename.provideRenameEdits(document, position, "더하다");
    expect(edit?.replacements).toHaveLength(2);
    expect(edit?.replacements.map(({ range }) => range.start)).toContainEqual(
      new FakePosition(0, 3),
    );
    expect(edit?.replacements.every(({ newText }) => newText === "더하다")).toBe(true);
  });

  it("renames only the selected shadowed local and its own references", async () => {
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
    const { references, rename } = createProviders();
    const document = documentFor(source);
    const innerPosition = positionOf(source, 4, "값");
    const locations = await references.provideReferences(document, innerPosition, {
      includeDeclaration: true,
    });
    const uses = await references.provideReferences(document, innerPosition, {
      includeDeclaration: false,
    });
    const edit = await rename.provideRenameEdits(document, innerPosition, "안쪽값");
    expect(locations).toHaveLength(2);
    expect(uses).toHaveLength(1);
    expect(edit?.replacements).toHaveLength(2);
    expect(edit?.replacements.map(({ range }) => range.start)).not.toContainEqual(
      new FakePosition(1, 7),
    );
  });

  it("uses UTF-16 source offsets for references after supplementary Unicode", async () => {
    const source = [
      "함수 봄() -> 정수 { 반환 1 }",
      "함수 시작() -> 없음 {",
      "    /* 🌱 */ 출력(봄())",
      "}",
    ].join("\n");
    const { references, rename } = createProviders();
    const document = documentFor(source);
    const position = positionOf(source, 2, "봄");
    const locations = await references.provideReferences(document, position, {
      includeDeclaration: true,
    });
    const edit = await rename.provideRenameEdits(document, position, "봄이");
    expect(locations).toHaveLength(2);
    expect(locations[1]?.range.start).toEqual(new FakePosition(2, 16));
    expect(edit?.replacements).toHaveLength(2);
  });

  it("rejects built-ins, invalid names, and conflicting semantic edits", async () => {
    const source = [
      "함수 시작() -> 없음 {",
      "    변수 값: 정수 = 1",
      "    변수 이름: 정수 = 2",
      "    출력(값)",
      "}",
    ].join("\n");
    const { rename } = createProviders();
    const document = documentFor(source);
    expect(await rename.prepareRename(document, positionOf(source, 3, "출력"))).toBeUndefined();
    const position = positionOf(source, 3, "값");
    expect(await rename.provideRenameEdits(document, position, "올바른 이름")).toBeUndefined();
    expect(await rename.provideRenameEdits(document, position, "이름")).toBeUndefined();
  });
});
