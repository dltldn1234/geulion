import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const extensionRoot = join(process.cwd(), "packages/vscode");
interface LanguageContribution {
  id: string;
  extensions: string[];
  configuration: string;
  icon: { light: string; dark: string };
}
interface Manifest {
  contributes: {
    languages: LanguageContribution[];
    grammars: { language: string; scopeName: string; path: string }[];
    snippets: { language: string; path: string }[];
  };
}
interface GrammarRule {
  begin?: string;
  end?: string;
  match?: string;
  name?: string;
}
interface Grammar {
  repository: Record<string, GrammarRule>;
}
interface LanguageConfiguration {
  comments: { lineComment: string; blockComment: [string, string] };
  brackets: [string, string][];
  autoClosingPairs: { open: string; close: string; notIn?: string[] }[];
}
interface Snippet {
  prefix: string | string[];
  body: string[];
}

const manifest = readJson<Manifest>(join(extensionRoot, "package.json"));
const grammar = readJson<Grammar>(join(extensionRoot, "syntaxes/geulion.tmLanguage.json"));
const configuration = readJson<LanguageConfiguration>(
  join(extensionRoot, "language-configuration.json"),
);
const snippets = readJson<Record<string, Snippet>>(
  join(extensionRoot, "snippets/geulion.code-snippets"),
);

function readJson<T>(path: string): T {
  const jsonc = readFileSync(path, "utf8").replace(/,\s*([}\]])/gu, "$1");
  return JSON.parse(jsonc) as T;
}

describe("GEULION VS Code language package", () => {
  it("registers .geul and points to packaged language resources", () => {
    const contributions = manifest.contributes;
    const language = contributions.languages[0]!;
    expect(language.id).toBe("geulion");
    expect(language.extensions).toContain(".geul");
    expect(language.configuration).toBe("./language-configuration.json");
    expect(contributions.grammars).toEqual([
      {
        language: "geulion",
        scopeName: "source.geulion",
        path: "./syntaxes/geulion.tmLanguage.json",
      },
    ]);
    expect(contributions.snippets[0]!.path).toBe("./snippets/geulion.code-snippets");

    for (const path of [
      language.configuration,
      language.icon.light,
      language.icon.dark,
      ...contributions.grammars.map((item) => item.path),
      ...contributions.snippets.map((item) => item.path),
    ]) {
      expect(existsSync(join(extensionRoot, path))).toBe(true);
    }
  });

  it("covers the lexer keywords, literals, operators, and comment forms", () => {
    const lexerSource = readFileSync("packages/lexer/src/lexer.ts", "utf8");
    const keywordTable = lexerSource.slice(
      lexerSource.indexOf("const keywords ="),
      lexerSource.indexOf("const multiCharacterOperators"),
    );
    const keywords = [...keywordTable.matchAll(/^\s*\["([^"]+)", TokenKind\.[A-Za-z]+\],/gmu)].map(
      (match) => match[1] ?? "",
    );
    const keywordPattern = grammar.repository.keywords!.match!;
    const constantPattern = grammar.repository.constants!.match!;
    const typePattern = grammar.repository.types!.match!;
    const grammarSource = JSON.stringify(grammar);
    for (const keyword of keywords) {
      expect(`${keywordPattern}${constantPattern}${typePattern}`).toContain(keyword);
    }
    expect(grammar.repository["line-comment"]!.begin).toBe("//");
    expect(grammar.repository["block-comment"]!.begin).toBe("/\\*");
    expect(grammar.repository["block-comment"]!.end).toBe("\\*/");
    expect(grammar.repository.strings!.end).toBe('"|$');
    expect(grammarSource).toContain("constant.numeric.real.geulion");
    expect(grammarSource).toContain("constant.numeric.integer.geulion");
    expect(grammarSource).toContain("constant.character.escape.geulion");
    expect(grammarSource).toContain("invalid.illegal.escape.geulion");
    expect(grammar.repository.operators!.match!).toContain("->");
    expect(grammar.repository.operators!.match!).toContain("\\?\\?");
  });

  it("uses the language's bracket and comment conventions and offers starter snippets", () => {
    expect(configuration.comments).toEqual({
      lineComment: "//",
      blockComment: ["/*", "*/"],
    });
    expect(configuration.brackets).toContainEqual(["{", "}"]);
    expect(configuration.brackets).toContainEqual(["[", "]"]);
    expect(configuration.brackets).toContainEqual(["(", ")"]);
    expect(configuration.autoClosingPairs).toContainEqual({
      open: '"',
      close: '"',
      notIn: ["string", "comment"],
    });
    expect(snippets["시작 함수"]!.prefix).toContain("시작");
    expect(snippets["공개 함수 선언"]!.body[0]!).toContain("공개 함수");
    expect(snippets["조건문"]!.body[0]!).toContain("만약");
    expect(snippets["반복문"]!.body[0]!).toContain("동안");
  });
});
