import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

interface ChildProcessLike {
  stdout: EventEmitter;
  stderr: EventEmitter;
  once(event: string, listener: (...args: never[]) => void): this;
}
interface OutputChannel {
  clear(): void;
  append(value: string): void;
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}
interface FakeVscode {
  commands: {
    registerCommand(id: string, callback: () => unknown): { dispose(): void };
  };
  window: {
    activeTextEditor?: {
      document: {
        languageId: string;
        uri: { fsPath: string };
      };
    };
    createOutputChannel(name: string): OutputChannel;
    showErrorMessage(message: string): void;
  };
  workspace: {
    getConfiguration(
      section: string,
      scope: unknown,
    ): {
      get<T>(name: string, fallback: T): T;
    };
    getWorkspaceFolder(uri: unknown): { uri: { fsPath: string } } | undefined;
  };
}
interface SpawnOptions {
  cwd: string;
  shell: false;
  windowsHide: true;
}
type SpawnProcess = (executable: string, args: string[], options: SpawnOptions) => ChildProcessLike;
interface ExtensionModule {
  activate(
    context: { subscriptions: { dispose(): void }[] },
    vscode: FakeVscode,
    spawnProcess: SpawnProcess,
  ): { output: OutputChannel };
}

const extension = createRequire(import.meta.url)(
  "../packages/vscode/extension.js",
) as ExtensionModule;

function createHost(configuration: Record<string, unknown> = {}) {
  const handlers = new Map<string, () => unknown>();
  const output = {
    lines: [] as string[],
    clear: vi.fn(() => (output.lines.length = 0)),
    append: vi.fn((value: string) => output.lines.push(value)),
    appendLine: vi.fn((value: string) => output.lines.push(`${value}\n`)),
    show: vi.fn(),
    dispose: vi.fn(),
  };
  const errors: string[] = [];
  const vscode: FakeVscode = {
    commands: {
      registerCommand(id, callback) {
        handlers.set(id, callback);
        return { dispose() {} };
      },
    },
    window: {
      createOutputChannel: vi.fn(() => output),
      showErrorMessage(message) {
        errors.push(message);
      },
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get<T>(name: string, fallback: T): T {
          return (configuration[name] as T | undefined) ?? fallback;
        },
      })),
      getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: "/workspace with spaces" } })),
    },
  };
  const context = { subscriptions: [] as { dispose(): void }[] };
  return { context, errors, handlers, output, vscode };
}

function createChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
}

describe("GEULION VS Code CLI commands", () => {
  it("registers check/run commands and passes file paths as separate arguments", async () => {
    const host = createHost({
      executable: "/tool path/geulion",
      arguments: ["--profile", "local profile"],
      languageVersion: "0.3",
    });
    host.vscode.window.activeTextEditor = {
      document: {
        languageId: "geulion",
        uri: { fsPath: "/workspace with spaces/source & test.geul" },
      },
    };
    const child = createChild();
    const spawnProcess = vi.fn(() => child) as unknown as SpawnProcess;
    extension.activate(host.context, host.vscode, spawnProcess);

    expect([...host.handlers.keys()]).toEqual([
      "geulion.checkCurrentFile",
      "geulion.runCurrentFile",
    ]);
    const complete = host.handlers.get("geulion.checkCurrentFile")!() as Promise<void>;
    expect(spawnProcess).toHaveBeenCalledWith(
      "/tool path/geulion",
      [
        "--profile",
        "local profile",
        "check",
        "/workspace with spaces/source & test.geul",
        "--language-version",
        "0.3",
      ],
      { cwd: "/workspace with spaces", shell: false, windowsHide: true },
    );
    child.stdout.emit("data", "검사 통과");
    child.emit("close", 0, null);
    await complete;
    expect(host.output.lines.join("")).toContain("검사 통과");
    expect(host.output.lines.join("")).toContain("완료되었습니다");
  });

  it("rejects v0.3 execution before spawning the CLI", async () => {
    const host = createHost({ languageVersion: "0.3" });
    host.vscode.window.activeTextEditor = {
      document: { languageId: "geulion", uri: { fsPath: "/workspace/game.geul" } },
    };
    const spawnProcess = vi.fn() as unknown as SpawnProcess;
    extension.activate(host.context, host.vscode, spawnProcess);

    await host.handlers.get("geulion.runCurrentFile")!();
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(host.errors[0]).toContain("v0.3 코드 실행");
  });

  it("reports CLI start and nonzero exit failures in the output channel", async () => {
    const host = createHost();
    host.vscode.window.activeTextEditor = {
      document: { languageId: "geulion", uri: { fsPath: "/workspace/game.geul" } },
    };
    const child = createChild();
    const spawnProcess = vi.fn(() => child) as unknown as SpawnProcess;
    extension.activate(host.context, host.vscode, spawnProcess);

    const complete = host.handlers.get("geulion.runCurrentFile")!() as Promise<void>;
    child.stderr.emit("data", "GE4001: 구문 오류");
    child.emit("close", 1, null);
    await complete;
    expect(host.errors[0]).toContain("종료 코드 1");
    expect(host.output.lines.join("")).toContain("GE4001");
  });

  it("rejects a non-GEULION editor without starting a process", async () => {
    const host = createHost();
    host.vscode.window.activeTextEditor = {
      document: { languageId: "typescript", uri: { fsPath: "/workspace/file.ts" } },
    };
    const spawnProcess = vi.fn() as unknown as SpawnProcess;
    extension.activate(host.context, host.vscode, spawnProcess);

    await host.handlers.get("geulion.checkCurrentFile")!();
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(host.errors[0]).toContain("`.geul` 파일이 아닙니다");
  });

  it("reports a missing CLI executable once", async () => {
    const host = createHost();
    host.vscode.window.activeTextEditor = {
      document: { languageId: "geulion", uri: { fsPath: "/workspace/game.geul" } },
    };
    const child = createChild();
    extension.activate(host.context, host.vscode, vi.fn(() => child) as unknown as SpawnProcess);

    const complete = host.handlers.get("geulion.checkCurrentFile")!() as Promise<void>;
    child.emit("error", new Error("ENOENT"));
    child.emit("close", null, null);
    await complete;
    expect(host.errors).toHaveLength(1);
    expect(host.errors[0]).toContain("ENOENT");
  });
});
