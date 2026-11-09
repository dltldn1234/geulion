import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

interface CompletionItem {
  label: string;
  kind: number;
  detail?: string;
  insertText?: { value: string };
}
interface CompletionProvider {
  provideCompletionItems(document: { uri: { fsPath: string } }): CompletionItem[];
}

const extension = createRequire(import.meta.url)("../packages/vscode/extension.js") as {
  activate(context: unknown, vscode: unknown, spawn: unknown): void;
};

function createCompletionProvider(version: "0.1" | "0.2" | "0.3") {
  let provider: CompletionProvider | undefined;
  const subscriptions: { dispose(): void }[] = [];
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
      registerCompletionItemProvider: (_selector: string, value: CompletionProvider) => {
        provider = value;
        return { dispose() {} };
      },
    },
    CompletionItemKind: { Keyword: 1, Function: 2, Snippet: 3 },
    CompletionItem: class {
      detail?: string;
      insertText?: { value: string };
      constructor(
        readonly label: string,
        readonly kind: number,
      ) {}
    },
    SnippetString: class {
      constructor(readonly value: string) {}
    },
  };
  extension.activate({ subscriptions } as never, vscode as never, (() => {}) as never);
  if (!provider) throw new Error("VS Code completion provider was not registered");
  return provider.provideCompletionItems({ uri: { fsPath: "/workspace/main.geul" } });
}

describe("GEULION VS Code completions", () => {
  it("covers the lexer keyword table and core built-ins", () => {
    const lexerSource = readFileSync("packages/lexer/src/lexer.ts", "utf8");
    const keywordTable = lexerSource.slice(
      lexerSource.indexOf("const keywords ="),
      lexerSource.indexOf("const multiCharacterOperators"),
    );
    const keywords = [...keywordTable.matchAll(/^\s*\["([^"]+)", TokenKind\.[A-Za-z]+\],/gmu)].map(
      (match) => match[1] ?? "",
    );
    const items = createCompletionProvider("0.1");
    const labels = items.map((item) => item.label);

    for (const keyword of keywords) expect(labels).toContain(keyword);
    expect(labels).toContain("출력");
    expect(labels).toContain("정수로");
    expect(labels).toContain("실수로");
    expect(labels).not.toContain("공개 함수 선언");
    expect(labels).not.toContain("문자열길이");
    expect(items.find((item) => item.label === "출력")?.insertText?.value).toBe("출력(${1:값})");
  });

  it("gates string helpers and public declarations by language version", () => {
    const v02 = createCompletionProvider("0.2").map((item) => item.label);
    expect(v02).toContain("문자열길이");
    expect(v02).toContain("문자열끝");
    expect(v02).not.toContain("공개 함수 선언");

    const v03Items = createCompletionProvider("0.3");
    expect(v03Items.map((item) => item.label)).toContain("공개 함수 선언");
    expect(v03Items.find((item) => item.label === "문자열포함")?.insertText?.value).toBe(
      "문자열포함(${1:문자열}, ${2:부분문자열})",
    );
  });
});
