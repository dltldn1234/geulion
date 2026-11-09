import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

interface SignatureHelpProvider {
  provideSignatureHelp(
    document: Document,
    position: { offset: number },
  ):
    | {
        signatures: { label: string; parameters: { label: string; documentation: string }[] }[];
        activeSignature: number;
        activeParameter: number;
      }
    | undefined;
}
interface Document {
  uri: { fsPath: string };
  getText(): string;
  offsetAt(position: { offset: number }): number;
}

const extension = createRequire(import.meta.url)("../packages/vscode/extension.js") as {
  activate(context: unknown, vscode: unknown, spawn: unknown): void;
};

function createProvider(version: "0.1" | "0.2" | "0.3") {
  let provider: SignatureHelpProvider | undefined;
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
      registerSignatureHelpProvider: (
        _selector: string,
        value: SignatureHelpProvider,
        ...triggerCharacters: string[]
      ) => {
        void triggerCharacters;
        provider = value;
        return { dispose() {} };
      },
    },
    SignatureHelp: class {
      signatures: { label: string; parameters: { label: string; documentation: string }[] }[] = [];
      activeSignature = 0;
      activeParameter = 0;
    },
    SignatureInformation: class {
      parameters: { label: string; documentation: string }[] = [];
      constructor(readonly label: string) {}
    },
    ParameterInformation: class {
      constructor(
        readonly label: string,
        readonly documentation: string,
      ) {}
    },
  };
  extension.activate({ subscriptions: [] } as never, vscode as never, (() => {}) as never);
  if (!provider) throw new Error("VS Code signature help provider was not registered");
  return provider;
}

function at(source: string): Document {
  return {
    uri: { fsPath: "/workspace/main.geul" },
    getText: () => source,
    offsetAt: (position) => position.offset,
  };
}

describe("GEULION VS Code signature help", () => {
  it("selects the active parameter while ignoring nested calls and commas in strings/comments", () => {
    const source = String.raw`문자열포함("가,\"나", 정수로(3), /* , 설명 */ `;
    const result = createProvider("0.2").provideSignatureHelp(at(source), {
      offset: source.length,
    });

    expect(result?.signatures[0]?.label).toContain("문자열포함");
    expect(result?.signatures[0]?.parameters.map((parameter) => parameter.label)).toEqual([
      "값: 문자열",
      "부분: 문자열",
    ]);
    expect(result?.activeSignature).toBe(0);
    expect(result?.activeParameter).toBe(1);

    for (const sourceWithComma of ['문자열포함("가,나"', "문자열포함(/* , 설명 */ "]) {
      const help = createProvider("0.2").provideSignatureHelp(at(sourceWithComma), {
        offset: sourceWithComma.length,
      });
      expect(help?.activeParameter).toBe(0);
    }
  });

  it("shows core signatures in v0.1 and gates string signatures by version", () => {
    const coreCall = "정수로(";
    const core = createProvider("0.1").provideSignatureHelp(at(coreCall), {
      offset: coreCall.length,
    });
    expect(core?.signatures[0]?.label).toBe("정수로(값: 실수) -> 정수");
    expect(core?.signatures[0]?.parameters).toHaveLength(1);

    const stringCall = "문자열길이(";
    expect(
      createProvider("0.1").provideSignatureHelp(at(stringCall), {
        offset: stringCall.length,
      }),
    ).toBeUndefined();
    expect(
      createProvider("0.3").provideSignatureHelp(at(stringCall), {
        offset: stringCall.length,
      })?.signatures[0]?.label,
    ).toBe("문자열길이(값: 문자열) -> 정수");
  });

  it("does not show built-in help for unrelated or completed calls", () => {
    const customCall = "사용자함수(";
    expect(
      createProvider("0.2").provideSignatureHelp(at(customCall), {
        offset: customCall.length,
      }),
    ).toBeUndefined();

    const completed = "출력(1)";
    expect(
      createProvider("0.1").provideSignatureHelp(at(completed), {
        offset: completed.length,
      }),
    ).toBeUndefined();

    for (const inComment of ["출력(값 // comment", "출력(값 /* comment"]) {
      expect(
        createProvider("0.1").provideSignatureHelp(at(inComment), {
          offset: inComment.length,
        }),
      ).toBeUndefined();
    }
  });
});
