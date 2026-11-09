/* global console, process */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDevelopmentPath = path.join(repositoryRoot, "packages/vscode");
const extensionTestsPath = path.join(repositoryRoot, "tests/vscode-extension-host/index.cjs");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "geulion-vscode-test-"));

try {
  const exitCode = await runTests({
    version: "1.90.0",
    ...(process.env.VSCODE_EXECUTABLE_PATH
      ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
      : {}),
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      repositoryRoot,
      `--user-data-dir=${path.join(temporaryRoot, "user-data")}`,
      `--extensions-dir=${path.join(temporaryRoot, "extensions")}`,
      "--disable-extensions",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-workspace-trust",
    ],
    extensionTestsEnv: {
      GEULION_TEST_ROOT: repositoryRoot,
      GEULION_NODE_EXECUTABLE: process.execPath,
      GEULION_CLI_ENTRY: path.join(repositoryRoot, "packages", "cli", "dist", "bin.js"),
    },
  });
  process.exitCode = exitCode;
} catch (error) {
  console.error("VS Code Extension Host integration tests failed:", error);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
