import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const extension = createRequire(import.meta.url)("../packages/vscode/extension.js") as {
  activate(context: unknown, vscode: unknown, spawn: unknown): void;
};

function createHost(spawn: unknown) {
  const changed: ((event: { document: Document }) => void)[] = [];
  const opened: ((document: Document) => void)[] = [];
  const closed: ((document: Document) => void)[] = [];
  const configurationChanged: ((event: {
    affectsConfiguration(section: string): boolean;
  }) => void)[] = [];
  const values = new Map<string, unknown[]>();
  const output = { clear() {}, append() {}, appendLine() {}, show() {}, dispose() {} };
  const subscriptions: { dispose(): void }[] = [];
  const vscode = {
    commands: { registerCommand: () => ({ dispose() {} }) },
    window: {
      createOutputChannel: () => output,
      showErrorMessage: vi.fn(),
      activeTextEditor: undefined,
    },
    workspace: {
      textDocuments: [] as Document[],
      getConfiguration: () => ({
        get: (_name: string, fallback: unknown) => fallback,
      }),
      getWorkspaceFolder: () => ({ uri: { fsPath: "/workspace" } }),
      onDidChangeTextDocument: (listener: (event: { document: Document }) => void) => {
        changed.push(listener);
        return { dispose() {} };
      },
      onDidOpenTextDocument: (listener: (document: Document) => void) => {
        opened.push(listener);
        return { dispose() {} };
      },
      onDidCloseTextDocument: (listener: (document: Document) => void) => {
        closed.push(listener);
        return { dispose() {} };
      },
      onDidChangeConfiguration: (
        listener: (event: { affectsConfiguration(section: string): boolean }) => void,
      ) => {
        configurationChanged.push(listener);
        return { dispose() {} };
      },
    },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri: { fsPath: string }, diagnostics: unknown[]) =>
          values.set(uri.fsPath, diagnostics),
        delete: (uri: { fsPath: string }) => values.delete(uri.fsPath),
        dispose() {},
      }),
    },
    Position: class {
      constructor(
        readonly line: number,
        readonly character: number,
      ) {}
    },
    Range: class {
      constructor(
        readonly start: { line: number; character: number },
        readonly end: { line: number; character: number },
      ) {}
    },
    Diagnostic: class {
      code?: string;
      source?: string;
      constructor(
        readonly range: unknown,
        public message: string,
        readonly severity: number,
      ) {}
    },
    DiagnosticSeverity: { Error: 0 },
  };
  extension.activate({ subscriptions } as never, vscode as never, spawn as never);
  return { changed, opened, closed, configurationChanged, values, vscode };
}

interface Document {
  languageId: string;
  version: number;
  uri: { fsPath: string; toString(): string };
  getText(): string;
}

function createDocument(text: string): Document {
  return {
    languageId: "geulion",
    version: 1,
    uri: {
      fsPath: "/workspace/idle game.geul",
      toString: () => "file:///workspace/idle%20game.geul",
    },
    getText: () => text,
  };
}

function createChild() {
  return Object.assign(new EventEmitter(), {
    stdin: { end: vi.fn() },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

afterEach(() => vi.useRealTimers());

describe("GEULION VS Code editor diagnostics", () => {
  it("checks in-memory source and maps UTF-16 positions into editor diagnostics", async () => {
    vi.useFakeTimers();
    const child = createChild();
    const spawn = vi.fn(() => child);
    const host = createHost(spawn);
    const document = createDocument("함수 시작() {}\n출력(없는값)");
    host.opened[0]!(document);

    await vi.advanceTimersByTimeAsync(300);
    expect(spawn).toHaveBeenCalledWith(
      "geulion",
      ["check", "-", "--format", "json", "--language-version", "0.1"],
      { cwd: "/workspace", shell: false, windowsHide: true },
    );
    expect(child.stdin.end).toHaveBeenCalledWith(document.getText());

    child.stdout.emit(
      "data",
      JSON.stringify({
        version: 1,
        success: false,
        diagnostics: [
          {
            code: "GE2001",
            message: "정의되지 않은 이름",
            range: { start: { line: 2, column: 5 }, end: { line: 2, column: 8 } },
          },
        ],
      }),
    );
    child.emit("close", 1, null);

    const diagnostic = host.values.get(document.uri.fsPath)?.[0] as {
      code: string;
      source: string;
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
    };
    expect(diagnostic.code).toBe("GE2001");
    expect(diagnostic.source).toBe("GEULION");
    expect(diagnostic.range).toMatchObject({
      start: { line: 1, character: 4 },
      end: { line: 1, character: 7 },
    });
  });

  it("kills obsolete checks, ignores their results, and clears diagnostics on close", async () => {
    vi.useFakeTimers();
    const children = [createChild(), createChild()];
    const spawn = vi.fn(() => children[spawn.mock.calls.length - 1]!);
    const host = createHost(spawn);
    const document = createDocument("오래된 내용");
    host.opened[0]!(document);
    await vi.advanceTimersByTimeAsync(300);
    const first = children[0]!;

    document.version = 2;
    host.changed[0]!({ document });
    expect(first.kill).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300);
    const second = children[1]!;
    first.stdout.emit("data", JSON.stringify({ version: 1, success: false, diagnostics: [] }));
    first.emit("close", 1, null);
    expect(host.values.get(document.uri.fsPath)).toEqual([]);

    second.stdout.emit("data", JSON.stringify({ version: 1, success: true, diagnostics: [] }));
    second.emit("close", 0, null);
    expect(host.values.get(document.uri.fsPath)).toEqual([]);
    host.closed[0]!(document);
    expect(host.values.has(document.uri.fsPath)).toBe(false);
  });
});
