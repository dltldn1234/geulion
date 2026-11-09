import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

interface HoverProvider {
  provideHover(
    document: {
      uri: { fsPath: string };
      getWordRangeAtPosition(
        position: { line: number; character: number },
        pattern: RegExp,
      ): Range | undefined;
      getText(range?: Range): string;
    },
    position: { line: number; character: number },
  ): { contents: { value: string }; range: Range } | undefined;
}
interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

const extension = createRequire(import.meta.url)("../packages/vscode/extension.js") as {
  activate(context: unknown, vscode: unknown, spawn: unknown): void;
};

function createProvider(version: "0.1" | "0.2" | "0.3") {
  let provider: HoverProvider | undefined;
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
      registerHoverProvider: (_selector: string, value: HoverProvider) => {
        provider = value;
        return { dispose() {} };
      },
    },
    MarkdownString: class {
      constructor(readonly value: string) {}
    },
    Hover: class {
      constructor(
        readonly contents: { value: string },
        readonly range: Range,
      ) {}
    },
  };
  extension.activate({ subscriptions: [] } as never, vscode as never, (() => {}) as never);
  if (!provider) throw new Error("VS Code hover provider was not registered");
  return provider;
}

function documentFor(source: string) {
  return {
    uri: { fsPath: "/workspace/main.geul" },
    offsetAt(position: { line: number; character: number }) {
      return (
        source
          .split("\n")
          .slice(0, position.line)
          .reduce((length, line) => length + line.length + 1, 0) + position.character
      );
    },
    getWordRangeAtPosition(position: { line: number; character: number }, pattern: RegExp) {
      const line = source.split("\n")[position.line] ?? "";
      const expression = new RegExp(pattern.source, "gu");
      for (const match of line.matchAll(expression)) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character < end) {
          return {
            start: { line: position.line, character: start },
            end: { line: position.line, character: end },
          };
        }
      }
      return undefined;
    },
    getText(range?: Range) {
      if (!range) return source;
      return (source.split("\n")[range.start.line] ?? "").slice(
        range.start.character,
        range.end.character,
      );
    },
  };
}

describe("GEULION VS Code hover documentation", () => {
  it("uses a Korean identifier range and shows core built-in and keyword documentation", () => {
    const document = documentFor("출력(값) + 정수");
    const hover = createProvider("0.1");
    const builtin = hover.provideHover(document, { line: 0, character: 1 });
    expect(builtin?.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 2 },
    });
    expect(builtin?.contents.value).toContain("출력(값: 임의) -> 없음");

    const keyword = hover.provideHover(document, { line: 0, character: 8 });
    expect(keyword?.contents.value).toContain("정수 타입");
  });

  it("gates versioned built-ins and the contextual public modifier", () => {
    const stringDocument = documentFor("문자열길이(값)");
    expect(
      createProvider("0.1").provideHover(stringDocument, { line: 0, character: 2 }),
    ).toBeUndefined();
    expect(
      createProvider("0.2").provideHover(stringDocument, { line: 0, character: 2 })?.contents.value,
    ).toContain("문자열길이(값: 문자열) -> 정수");

    const publicDocument = documentFor("공개 함수 계산() -> 정수 {}");
    expect(
      createProvider("0.1").provideHover(publicDocument, { line: 0, character: 1 }),
    ).toBeUndefined();
    expect(
      createProvider("0.3").provideHover(publicDocument, { line: 0, character: 1 })?.contents.value,
    ).toContain("브라우저 모듈");
  });

  it("does not show built-in documentation for unknown names or punctuation", () => {
    const document = documentFor("사용자함수(값)");
    const hover = createProvider("0.3");
    expect(hover.provideHover(document, { line: 0, character: 3 })).toBeUndefined();
    expect(hover.provideHover(document, { line: 0, character: 12 })).toBeUndefined();

    const comments = documentFor("// 출력\n/* 정수 */");
    expect(hover.provideHover(comments, { line: 0, character: 4 })).toBeUndefined();
    expect(hover.provideHover(comments, { line: 1, character: 4 })).toBeUndefined();
  });
});
