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
  {
    label: "출력",
    snippet: "출력(${1:값})",
    returnType: "없음",
    parameters: [{ label: "값: 임의", documentation: "출력할 값" }],
  },
  {
    label: "정수로",
    snippet: "정수로(${1:실수값})",
    returnType: "정수",
    parameters: [{ label: "값: 실수", documentation: "정수로 변환할 실수" }],
  },
  {
    label: "실수로",
    snippet: "실수로(${1:정수값})",
    returnType: "실수",
    parameters: [{ label: "값: 정수", documentation: "실수로 변환할 정수" }],
  },
];
const STRING_FUNCTIONS = [
  {
    label: "문자열길이",
    snippet: "문자열길이(${1:문자열})",
    returnType: "정수",
    parameters: [{ label: "값: 문자열", documentation: "길이를 구할 문자열" }],
  },
  {
    label: "문자열포함",
    snippet: "문자열포함(${1:문자열}, ${2:부분문자열})",
    returnType: "불리언",
    parameters: [
      { label: "값: 문자열", documentation: "검색할 문자열" },
      { label: "부분: 문자열", documentation: "포함 여부를 확인할 문자열" },
    ],
  },
  {
    label: "문자열시작",
    snippet: "문자열시작(${1:문자열}, ${2:접두사})",
    returnType: "불리언",
    parameters: [
      { label: "값: 문자열", documentation: "확인할 문자열" },
      { label: "접두사: 문자열", documentation: "시작 부분과 비교할 문자열" },
    ],
  },
  {
    label: "문자열끝",
    snippet: "문자열끝(${1:문자열}, ${2:접미사})",
    returnType: "불리언",
    parameters: [
      { label: "값: 문자열", documentation: "확인할 문자열" },
      { label: "접미사: 문자열", documentation: "끝 부분과 비교할 문자열" },
    ],
  },
];
const KEYWORD_DOCUMENTATION = {
  상수: "값을 한 번만 바인딩합니다. 이후 대입할 수 없습니다.",
  변수: "다시 대입할 수 있는 지역 값을 선언합니다.",
  함수: "매개변수와 반환 타입을 갖는 함수를 선언합니다.",
  반환: "현재 함수에서 값을 반환합니다.",
  만약: "조건이 참일 때 block을 실행합니다.",
  아니면: "앞선 조건이 거짓일 때 대체 block을 실행합니다.",
  동안: "조건이 참인 동안 block을 반복합니다.",
  중단: "가장 안쪽 반복문을 종료합니다.",
  계속: "가장 안쪽 반복문의 다음 반복으로 이동합니다.",
  그리고: "왼쪽과 오른쪽 조건이 모두 참인지 확인합니다.",
  또는: "왼쪽 또는 오른쪽 조건이 참인지 확인합니다.",
  아니다: "불리언 값을 반전합니다.",
  참: "참을 나타내는 불리언 literal입니다.",
  거짓: "거짓을 나타내는 불리언 literal입니다.",
  정수: "부호 있는 64-bit 정수 타입입니다.",
  실수: "IEEE 754 binary64 실수 타입입니다.",
  문자열: "Unicode scalar 열을 저장하는 불변 문자열 타입입니다.",
  불리언: "`참` 또는 `거짓`을 갖는 타입입니다.",
  없음: "값을 반환하지 않는 함수의 반환 타입입니다.",
  목록: "같은 타입의 값을 순서대로 저장하는 타입 생성자입니다.",
  사전: "문자열 key와 같은 타입의 value를 저장하는 타입 생성자입니다.",
  선택: "값이 있거나 없을 수 있는 타입 생성자입니다.",
  일부: "선택 타입에 값이 있음을 나타냅니다.",
  비어있음: "값이 없는 선택 값을 나타냅니다.",
};

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
          item.detail = formatFunctionSignature(entry);
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
  if (vscode.languages?.registerSignatureHelpProvider) {
    const signatureProvider = {
      provideSignatureHelp(document, position) {
        const activeCall = findActiveCall(document.getText(), document.offsetAt(position));
        if (!activeCall) return undefined;
        const configuration = vscode.workspace.getConfiguration("geulion", document.uri);
        const version = configuration.get("languageVersion", "0.1");
        const availableFunctions =
          version === "0.2" || version === "0.3"
            ? [...CORE_FUNCTIONS, ...STRING_FUNCTIONS]
            : CORE_FUNCTIONS;
        const fn = availableFunctions.find((candidate) => candidate.label === activeCall.name);
        if (!fn) return undefined;
        const signatureLabel = formatFunctionSignature(fn);
        const signature = new vscode.SignatureInformation(signatureLabel, signatureLabel);
        signature.parameters = fn.parameters.map(
          (parameter) => new vscode.ParameterInformation(parameter.label, parameter.documentation),
        );
        const help = new vscode.SignatureHelp();
        help.signatures = [signature];
        help.activeSignature = 0;
        help.activeParameter = Math.min(activeCall.argumentIndex, fn.parameters.length - 1);
        return help;
      },
    };
    context.subscriptions.push(
      vscode.languages.registerSignatureHelpProvider("geulion", signatureProvider, "(", ","),
    );
  }
  if (vscode.languages?.registerHoverProvider) {
    const hoverProvider = {
      provideHover(document, position) {
        if (isInsideComment(document.getText(), document.offsetAt(position))) return undefined;
        const range = document.getWordRangeAtPosition(
          position,
          /[\p{ID_Start}_][\p{ID_Continue}_]*/u,
        );
        if (!range) return undefined;
        const word = document.getText(range);
        const configuration = vscode.workspace.getConfiguration("geulion", document.uri);
        const version = configuration.get("languageVersion", "0.1");
        const availableFunctions =
          version === "0.2" || version === "0.3"
            ? [...CORE_FUNCTIONS, ...STRING_FUNCTIONS]
            : CORE_FUNCTIONS;
        const fn = availableFunctions.find((candidate) => candidate.label === word);
        let markdown;
        if (fn) {
          markdown = `**${formatFunctionSignature(fn)}**\n\n${fn.parameters.map((parameter) => parameter.documentation).join("; ")}`;
        } else if (word === "공개" && version === "0.3") {
          markdown =
            "`공개 함수`는 v0.3 브라우저 모듈에서 host가 호출할 수 있는 함수를 선언합니다.";
        } else if (Object.hasOwn(KEYWORD_DOCUMENTATION, word)) {
          markdown = KEYWORD_DOCUMENTATION[word];
        } else {
          return undefined;
        }
        return new vscode.Hover(new vscode.MarkdownString(markdown), range);
      },
    };
    context.subscriptions.push(vscode.languages.registerHoverProvider("geulion", hoverProvider));
  }
  return { output };
}

function findActiveCall(source, cursorOffset) {
  const prefix = source.slice(0, cursorOffset);
  const delimiters = [];
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < prefix.length; index += 1) {
    const current = prefix[index];
    const next = prefix[index + 1];
    if (inLineComment) {
      if (current === "\n" || current === "\r") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (current === '"') {
      inString = true;
      continue;
    }
    if (current === "(" || current === "[" || current === "{") {
      let call;
      if (current === "(") {
        const preceding = prefix.slice(0, index).match(/([\p{ID_Start}_][\p{ID_Continue}_]*)\s*$/u);
        if (preceding) call = { name: preceding[1], argumentIndex: 0 };
      }
      delimiters.push({ close: current === "(" ? ")" : current === "[" ? "]" : "}", call });
      continue;
    }
    if (current === ")" || current === "]" || current === "}") {
      if (delimiters[delimiters.length - 1]?.close === current) delimiters.pop();
      continue;
    }
    if (current === "," && delimiters[delimiters.length - 1]?.call) {
      delimiters[delimiters.length - 1].call.argumentIndex += 1;
    }
  }
  if (inLineComment || inBlockComment) return undefined;
  for (let index = delimiters.length - 1; index >= 0; index -= 1) {
    if (delimiters[index].call) return delimiters[index].call;
  }
  return undefined;
}

function isInsideComment(source, cursorOffset) {
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < cursorOffset; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (inLineComment) {
      if (current === "\n" || current === "\r") inLineComment = false;
      else continue;
    }
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      continue;
    }
    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
    } else if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
    }
  }
  return inLineComment || inBlockComment;
}

function formatFunctionSignature(fn) {
  const parameters = fn.parameters.map((parameter) => parameter.label).join(", ");
  return `${fn.label}(${parameters}) -> ${fn.returnType}`;
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
