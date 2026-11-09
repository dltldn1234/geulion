/* global console, module, process, require, setTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads the CommonJS test runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

function positionAt(source, needle, occurrence = 0) {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = source.indexOf(needle, offset + 1);
    assert.notEqual(offset, -1, `Could not find occurrence ${index + 1} of ${needle}`);
  }
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return new vscode.Position(lines.length - 1, lines.at(-1).length);
}

async function waitFor(predicate, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function run() {
  const repositoryRoot = process.env.GEULION_TEST_ROOT;
  assert.ok(repositoryRoot, "GEULION_TEST_ROOT must point to the repository");
  const extension = vscode.extensions.getExtension("dltldn1234.geulion-language-support");
  assert.ok(extension, "GEULION extension was not discovered by the Extension Host");

  const filename = path.join(repositoryRoot, "tests", `unsaved-${process.pid}.geul`);
  const documentUri = vscode.Uri.file(filename);
  const source = [
    "공개 함수 합계(값: 정수) -> 정수 { 반환 값 }",
    "함수 시작() -> 없음 {",
    "    출력(합계(1))",
    "}",
  ].join("\n");
  const unsavedSource = `// 🌱 unsaved host buffer\n${source}`;

  try {
    await fs.writeFile(filename, source, "utf8");
    const document = await vscode.workspace.openTextDocument(documentUri);
    assert.equal(document.languageId, "geulion");
    await waitFor(
      () => extension.isActive,
      "Opening a .geul document did not activate the extension",
    );
    await vscode.window.showTextDocument(document);
    await vscode.workspace
      .getConfiguration("geulion", document.uri)
      .update("executable", "/bin/sh", vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration("geulion", document.uri)
      .update(
        "arguments",
        [path.join(repositoryRoot, "scripts", "geulion-test-cli.sh")],
        vscode.ConfigurationTarget.Global,
      );
    await vscode.workspace
      .getConfiguration("geulion", document.uri)
      .update("languageVersion", "0.3", vscode.ConfigurationTarget.Global);

    const unsavedEdit = new vscode.WorkspaceEdit();
    unsavedEdit.insert(document.uri, new vscode.Position(0, 0), "// 🌱 unsaved host buffer\n");
    assert.equal(await vscode.workspace.applyEdit(unsavedEdit), true);
    assert.equal(document.isDirty, true, "The integration source must include unsaved edits");

    assert.equal(vscode.languages.getDiagnostics(document.uri).length, 0);

    const referencePosition = positionAt(unsavedSource, "합계", 1);
    const references = await vscode.commands.executeCommand(
      "vscode.executeReferenceProvider",
      document.uri,
      referencePosition,
    );
    assert.equal(references.length, 2, "Expected declaration and call reference");
    assert.deepEqual(references.map((location) => location.range.start.line).sort(), [1, 3]);

    const renamePosition = positionAt(unsavedSource, "합계", 1);
    const edits = await vscode.commands.executeCommand(
      "vscode.executeDocumentRenameProvider",
      document.uri,
      renamePosition,
      "모으기",
    );
    assert.ok(edits, "Rename provider returned no workspace edit");
    const replacements = edits.get(document.uri);
    assert.equal(replacements.length, 2, "Expected declaration and call to be renamed");
    const renamedSource = [...replacements]
      .sort((left, right) => right.range.start.compareTo(left.range.start))
      .reduce(
        (text, edit) =>
          text.slice(0, document.offsetAt(edit.range.start)) +
          edit.newText +
          text.slice(document.offsetAt(edit.range.end)),
        unsavedSource,
      );
    assert.equal((renamedSource.match(/모으기/gu) ?? []).length, 2);
    assert.equal((renamedSource.match(/합계/gu) ?? []).length, 0);

    const diagnosticsEdit = new vscode.WorkspaceEdit();
    diagnosticsEdit.insert(document.uri, new vscode.Position(4, 0), "    출력(없는값)\n");
    assert.equal(await vscode.workspace.applyEdit(diagnosticsEdit), true);
    const diagnosticsConfiguration = vscode.workspace.getConfiguration("geulion", document.uri);
    const missingName = await waitFor(
      () =>
        vscode.languages
          .getDiagnostics(document.uri)
          .find((diagnostic) => diagnostic.message.includes("없는값")),
      `Diagnostics were not published (executable=${diagnosticsConfiguration.get("executable")}, arguments=${JSON.stringify(diagnosticsConfiguration.get("arguments"))}, version=${diagnosticsConfiguration.get("languageVersion")}, diagnostics=${JSON.stringify(vscode.languages.getDiagnostics(document.uri).map((item) => item.message))})`,
    );
    assert.equal(missingName.range.start.line, 4);
    assert.equal(missingName.range.start.character, 7);

    console.log(
      "VS Code Extension Host: activation, unsaved diagnostics, references, and rename passed",
    );
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await fs.rm(filename, { force: true });
  }
}

module.exports.run = run;
