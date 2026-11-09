/* global module, require */
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code injects its API through CommonJS. */
const { spawn } = require("node:child_process");
const path = require("node:path");

const LANGUAGE_VERSIONS = new Set(["0.1", "0.2", "0.3"]);
const KEYWORDS = [
  "상수",
  "변수",
  "함수",
  "반환",
  "만약",
  "아니면",
  "동안",
  "중단",
  "계속",
  "그리고",
  "또는",
  "아니다",
  "참",
  "거짓",
  "정수",
  "실수",
  "문자열",
  "불리언",
  "없음",
  "목록",
  "사전",
  "선택",
  "일부",
  "비어있음",
];
const CORE_FUNCTIONS = [
  { label: "출력", detail: "출력(값: 임의) -> 없음", snippet: "출력(${1:값})" },
  { label: "정수로", detail: "정수로(값: 실수) -> 정수", snippet: "정수로(${1:실수값})" },
  { label: "실수로", detail: "실수로(값: 정수) -> 실수", snippet: "실수로(${1:정수값})" },
];
const STRING_FUNCTIONS = [
  {
    label: "문자열길이",
    detail: "문자열길이(값: 문자열) -> 정수",
    snippet: "문자열길이(${1:문자열})",
  },
  {
    label: "문자열포함",
    detail: "문자열포함(값: 문자열, 부분: 문자열) -> 불리언",
    snippet: "문자열포함(${1:문자열}, ${2:부분문자열})",
  },
  {
    label: "문자열시작",
    detail: "문자열시작(값: 문자열, 접두사: 문자열) -> 불리언",
    snippet: "문자열시작(${1:문자열}, ${2:접두사})",
  },
  {
    label: "문자열끝",
    detail: "문자열끝(값: 문자열, 접미사: 문자열) -> 불리언",
    snippet: "문자열끝(${1:문자열}, ${2:접미사})",
  },
];

function activate(context, vscodeApi, spawnProcess = spawn) {
  const vscode = vscodeApi ?? require("vscode");
  const output = vscode.window.createOutputChannel("GEULION");
  context.subscriptions.push(output);

  const registerCommand = (commandId, cliCommand) => {
    const disposable = vscode.commands.registerCommand(commandId, () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document) return reportError("먼저 GEULION 파일을 열어 주세요.");

      const filePath = document.uri.fsPath;
      if (
        document.languageId !== "geulion" ||
        typeof filePath !== "string" ||
        path.extname(filePath).toLowerCase() !== ".geul"
      ) {
        return reportError("현재 파일은 GEULION `.geul` 파일이 아닙니다.");
      }

      const configuration = vscode.workspace.getConfiguration("geulion", document.uri);
      const executable = configuration.get("executable", "geulion");
      const prefixArguments = configuration.get("arguments", []);
      const languageVersion = configuration.get("languageVersion", "0.1");
      if (typeof executable !== "string" || executable.trim() === "") {
        return reportError("GEULION CLI 실행 파일 경로를 설정해 주세요.");
      }
      if (
        !Array.isArray(prefixArguments) ||
        !prefixArguments.every((argument) => typeof argument === "string")
      ) {
        return reportError("GEULION CLI 앞에 전달할 인자 설정이 올바르지 않습니다.");
      }
      if (typeof languageVersion !== "string" || !LANGUAGE_VERSIONS.has(languageVersion)) {
        return reportError("GEULION 언어 버전은 0.1, 0.2 또는 0.3이어야 합니다.");
      }
      if (cliCommand === "run" && languageVersion === "0.3") {
        return reportError(
          "GEULION CLI는 v0.3 코드 실행을 아직 지원하지 않습니다. 검사 명령을 사용해 주세요.",
        );
      }

      const args = [
        ...prefixArguments,
        cliCommand,
        filePath,
        "--language-version",
        languageVersion,
      ];
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const cwd = workspaceFolder?.uri.fsPath ?? path.dirname(filePath);
      output.clear();
      output.appendLine(`GEULION ${cliCommand === "check" ? "검사" : "실행"}: ${filePath}`);
      output.show(true);

      return new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          resolve();
        };
        let child;
        try {
          child = spawnProcess(executable, args, {
            cwd,
            shell: false,
            windowsHide: true,
          });
        } catch (error) {
          reportError(`GEULION CLI를 시작하지 못했습니다: ${errorMessage(error)}`);
          finish();
          return;
        }
        child.stdout?.on("data", (chunk) => output.append(String(chunk)));
        child.stderr?.on("data", (chunk) => output.append(String(chunk)));
        child.once("error", (error) => {
          reportError(`GEULION CLI를 시작하지 못했습니다: ${errorMessage(error)}`);
          finish();
        });
        child.once("close", (code, signal) => {
          if (finished) return;
          if (code === 0) {
            output.appendLine("GEULION 명령이 완료되었습니다.");
          } else {
            const status = code === null ? `신호 ${signal ?? "알 수 없음"}` : `종료 코드 ${code}`;
            reportError(`GEULION 명령이 실패했습니다 (${status}).`);
          }
          finish();
        });
      });
    });
    context.subscriptions.push(disposable);
  };

  const reportError = (message) => {
    output.appendLine(message);
    output.show(true);
    void vscode.window.showErrorMessage(message);
  };

  registerCommand("geulion.checkCurrentFile", "check");
  registerCommand("geulion.runCurrentFile", "run");

  if (vscode.languages && vscode.workspace.onDidChangeTextDocument) {
    registerEditorDiagnostics(context, vscode, output, spawnProcess);
  }
  if (vscode.languages?.registerCompletionItemProvider) {
    const completionProvider = {
      provideCompletionItems(document) {
        const configuration = vscode.workspace.getConfiguration("geulion", document.uri);
        const version = configuration.get("languageVersion", "0.1");
        const functions = [...CORE_FUNCTIONS];
        if (version === "0.2" || version === "0.3") functions.push(...STRING_FUNCTIONS);
        const items = KEYWORDS.map((label) => {
          const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
          item.detail = "GEULION 예약어";
          return item;
        });
        for (const entry of functions) {
          const item = new vscode.CompletionItem(entry.label, vscode.CompletionItemKind.Function);
          item.detail = entry.detail;
          item.insertText = new vscode.SnippetString(entry.snippet);
          items.push(item);
        }
        if (version === "0.3") {
          const item = new vscode.CompletionItem(
            "공개 함수 선언",
            vscode.CompletionItemKind.Snippet,
          );
          item.detail = "v0.3 공개 함수 선언";
          item.insertText = new vscode.SnippetString(
            "공개 함수 ${1:이름}() -> ${2:없음} {\n\t$0\n}",
          );
          items.push(item);
        }
        return items;
      },
    };
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider("geulion", completionProvider),
    );
  }
  return { output };
}

function registerEditorDiagnostics(context, vscode, output, spawnProcess) {
  const collection = vscode.languages.createDiagnosticCollection("geulion");
  context.subscriptions.push(collection);
  const pending = new Map();
  const isGeulionDocument = (document) =>
    document.languageId === "geulion" &&
    path.extname(document.uri.fsPath).toLowerCase() === ".geul";

  const clearPending = (key, state) => {
    if (state.timer) globalThis.clearTimeout(state.timer);
    state.child?.kill();
    pending.delete(key);
  };

  const schedule = (document) => {
    if (!isGeulionDocument(document)) return;
    const key = document.uri.toString();
    const previous = pending.get(key);
    const generation = (previous?.generation ?? 0) + 1;
    if (previous?.timer) globalThis.clearTimeout(previous.timer);
    previous?.child?.kill();
    collection.set(document.uri, []);
    const state = { generation, timer: undefined, child: undefined };
    pending.set(key, state);
    state.timer = globalThis.setTimeout(() => {
      state.timer = undefined;
      const configuration = vscode.workspace.getConfiguration("geulion", document.uri);
      const executable = configuration.get("executable", "geulion");
      const prefixArguments = configuration.get("arguments", []);
      const languageVersion = configuration.get("languageVersion", "0.1");
      if (
        typeof executable !== "string" ||
        executable.trim() === "" ||
        !Array.isArray(prefixArguments) ||
        !prefixArguments.every((argument) => typeof argument === "string") ||
        typeof languageVersion !== "string" ||
        !LANGUAGE_VERSIONS.has(languageVersion)
      ) {
        collection.set(document.uri, []);
        output.appendLine("GEULION 편집기 진단 설정이 올바르지 않습니다.");
        return;
      }
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const cwd = workspaceFolder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
      let child;
      try {
        child = spawnProcess(
          executable,
          [
            ...prefixArguments,
            "check",
            "-",
            "--format",
            "json",
            "--language-version",
            languageVersion,
          ],
          { cwd, shell: false, windowsHide: true },
        );
      } catch (error) {
        collection.set(document.uri, []);
        output.appendLine(`GEULION 편집기 검사를 시작하지 못했습니다: ${errorMessage(error)}`);
        return;
      }
      state.child = child;
      let stdout = "";
      let stderr = "";
      let spawnFailed = false;
      child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
      child.once("error", (error) => {
        if (pending.get(key) !== state) return;
        spawnFailed = true;
        collection.set(document.uri, []);
        output.appendLine(`GEULION 편집기 검사를 시작하지 못했습니다: ${errorMessage(error)}`);
        state.child = undefined;
      });
      child.once("close", (code) => {
        if (pending.get(key) !== state || document.version !== state.documentVersion || spawnFailed)
          return;
        state.child = undefined;
        pending.delete(key);
        if (code !== 0 && code !== 1) {
          collection.set(document.uri, []);
          output.appendLine(stderr || "GEULION 편집기 검사가 실패했습니다.");
          return;
        }
        try {
          const result = JSON.parse(stdout);
          if (
            result.version !== 1 ||
            !Array.isArray(result.diagnostics) ||
            typeof result.success !== "boolean"
          ) {
            throw new Error("지원하지 않는 진단 응답 형식입니다.");
          }
          const diagnostics = result.diagnostics.flatMap((item) => {
            const range = new vscode.Range(
              new vscode.Position(
                (item.range?.start?.line ?? 1) - 1,
                (item.range?.start?.column ?? 1) - 1,
              ),
              new vscode.Position(
                (item.range?.end?.line ?? 1) - 1,
                (item.range?.end?.column ?? 1) - 1,
              ),
            );
            const diagnostic = new vscode.Diagnostic(
              range,
              item.message,
              vscode.DiagnosticSeverity.Error,
            );
            diagnostic.code = item.code;
            diagnostic.source = "GEULION";
            if (item.help) diagnostic.message = `${item.message}\n${item.help}`;
            return [diagnostic];
          });
          collection.set(document.uri, diagnostics);
        } catch (error) {
          collection.set(document.uri, []);
          output.appendLine(`GEULION 진단 응답을 읽지 못했습니다: ${errorMessage(error)}`);
        }
      });
      state.documentVersion = document.version;
      child.stdin?.end(document.getText());
    }, 300);
  };

  const changed = vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document));
  const opened = vscode.workspace.onDidOpenTextDocument(schedule);
  const closed = vscode.workspace.onDidCloseTextDocument((document) => {
    const key = document.uri.toString();
    const state = pending.get(key);
    if (state) clearPending(key, state);
    collection.delete(document.uri);
  });
  const configurationChanged = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("geulion")) {
      for (const document of vscode.workspace.textDocuments) schedule(document);
    }
  });
  context.subscriptions.push(changed, opened, closed, configurationChanged, {
    dispose() {
      for (const [key, state] of pending) clearPending(key, state);
    },
  });
  for (const document of vscode.workspace.textDocuments) schedule(document);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = { activate };
