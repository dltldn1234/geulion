/* global module, require */
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code injects its API through CommonJS. */
const { spawn } = require("node:child_process");
const path = require("node:path");

const LANGUAGE_VERSIONS = new Set(["0.1", "0.2", "0.3"]);

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
  return { output };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = { activate };
