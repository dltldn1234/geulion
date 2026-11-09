import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type Message = Record<string, unknown>;

class LspClient {
  readonly child: ChildProcessWithoutNullStreams;
  #buffer = Buffer.alloc(0);
  #stdout: Buffer[] = [];
  #stderr: Buffer[] = [];
  #messages: Message[] = [];
  #waiters: { predicate: (message: Message) => boolean; resolve: (message: Message) => void }[] =
    [];
  #nextId = 1;

  constructor() {
    const serverPath = fileURLToPath(
      new URL("../packages/language-server/dist/server.js", import.meta.url),
    );
    this.child = spawn(process.execPath, [serverPath], { stdio: "pipe" });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.#stdout.push(chunk);
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#readMessages();
    });
    this.child.stderr.on("data", (chunk: Buffer) => this.#stderr.push(chunk));
  }

  send(message: Message): void {
    const frame = this.#frame(message);
    // Split the frame to cover incremental header and body reads.
    const split = Math.min(7, frame.length);
    this.child.stdin.write(frame.subarray(0, split));
    this.child.stdin.write(frame.subarray(split));
  }

  sendBatch(messages: Message[]): void {
    this.child.stdin.write(Buffer.concat(messages.map((message) => this.#frame(message))));
  }

  sendRawBatch(bodies: string[]): void {
    const frames = bodies.map((body) => {
      const bytes = Buffer.from(body, "utf8");
      return Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`), bytes]);
    });
    this.child.stdin.write(Buffer.concat(frames));
  }

  sendRaw(frame: Buffer | string): void {
    this.child.stdin.write(typeof frame === "string" ? Buffer.from(frame) : frame);
  }

  endInput(): void {
    this.child.stdin.end();
  }

  async waitForExit(): Promise<{ code: number | null; stdout: Buffer; stderr: Buffer }> {
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Language server did not exit")), 3000);
      this.child.once("close", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    return { code, stdout: Buffer.concat(this.#stdout), stderr: Buffer.concat(this.#stderr) };
  }

  #frame(message: Message): Buffer {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
  }

  request(method: string, params: Message = {}): Promise<Message> {
    const id = this.#nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    return this.#waitFor((message) => message.id === id);
  }

  notification(method: string, params: Message = {}): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  notificationBatch(...notifications: Message[]): void {
    this.sendBatch(notifications.map((notification) => ({ jsonrpc: "2.0", ...notification })));
  }

  waitFor(predicate: (message: Message) => boolean): Promise<Message> {
    return this.#waitFor(predicate);
  }

  async close(): Promise<void> {
    await this.request("shutdown");
    this.notification("exit");
    this.child.stdin.end();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Language server did not exit")), 3000);
      this.child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  #waitFor(predicate: (message: Message) => boolean): Promise<Message> {
    const index = this.#messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.#messages.splice(index, 1)[0] ?? {});
    return new Promise((resolve) => this.#waiters.push({ predicate, resolve }));
  }

  #readMessages(): void {
    while (true) {
      const boundary = this.#buffer.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const header = this.#buffer.subarray(0, boundary).toString("ascii");
      const length = Number(/Content-Length:\s*(\d+)/iu.exec(header)?.[1]);
      if (!Number.isInteger(length) || this.#buffer.length < boundary + 4 + length) return;
      const body = this.#buffer.subarray(boundary + 4, boundary + 4 + length);
      this.#buffer = this.#buffer.subarray(boundary + 4 + length);
      const message = JSON.parse(body.toString("utf8")) as Message;
      const waiterIndex = this.#waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) this.#waiters.splice(waiterIndex, 1)[0]?.resolve(message);
      else this.#messages.push(message);
    }
  }
}

async function openEditorDocument(
  client: LspClient,
  options: { languageVersion: string; snippetSupport: boolean; uri: string; text: string },
): Promise<void> {
  await client.request("initialize", {
    capabilities: {
      textDocument: { completion: { completionItem: { snippetSupport: options.snippetSupport } } },
    },
    initializationOptions: { languageVersion: options.languageVersion },
  });
  client.notification("initialized");
  client.notification("textDocument/didOpen", {
    textDocument: {
      uri: options.uri,
      languageId: "geulion",
      version: 1,
      text: options.text,
    },
  });
}

describe("GEULION Language Server Protocol", () => {
  it("searches closed workspace files with live disk results and open-buffer overlays", async () => {
    const root = await mkdtemp(join(tmpdir(), "geulion-lsp-symbols-"));
    const linkedSource = await mkdtemp(join(tmpdir(), "geulion-lsp-linked-"));
    const client = new LspClient();
    try {
      const sourceDirectory = join(root, "src");
      await mkdir(sourceDirectory);
      for (const directory of [".git", "node_modules", "dist", "coverage"])
        await mkdir(join(root, directory));
      const closedPath = join(sourceDirectory, "closed.geul");
      const editablePath = join(sourceDirectory, "editable.geul");
      const textFilePath = join(sourceDirectory, "notes.txt");
      await writeFile(join(linkedSource, "linked.geul"), "함수 링크대상() -> 없음 { }");
      await symlink(linkedSource, join(root, "linked-source"));
      await writeFile(closedPath, "함수 닫힌파일() -> 정수 { 반환 1 }");
      await writeFile(editablePath, "함수 저장된이름() -> 정수 { 반환 2 }");
      await writeFile(textFilePath, "함수 텍스트문서() -> 없음 { }");
      for (const directory of [".git", "node_modules", "dist", "coverage"])
        await writeFile(join(root, directory, "ignored.geul"), "함수 제외대상() -> 없음 { }");
      await writeFile(join(sourceDirectory, "invalid-utf8.geul"), Buffer.from([0xff]));

      const rootUri = pathToFileURL(root).toString();
      const initialized = await client.request("initialize", {
        capabilities: {},
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: "GEULION" }],
      });
      expect(initialized.error).toBeUndefined();
      client.notification("initialized");
      const editableUri = pathToFileURL(editablePath).toString();
      client.notification("textDocument/didOpen", {
        textDocument: {
          uri: editableUri,
          languageId: "geulion",
          version: 1,
          text: "함수 편집중() -> 정수 { 반환 3 }",
        },
      });
      client.notification("textDocument/didOpen", {
        textDocument: {
          uri: pathToFileURL(join(linkedSource, "outside.geul")).toString(),
          languageId: "geulion",
          version: 1,
          text: "함수 워크스페이스외부() -> 없음 { }",
        },
      });
      client.notification("textDocument/didOpen", {
        textDocument: {
          uri: pathToFileURL(textFilePath).toString(),
          languageId: "plaintext",
          version: 1,
          text: "함수 제외확장자() -> 없음 { }",
        },
      });

      const initial = await client.request("workspace/symbol", { query: "" });
      expect((initial.result as { name: string }[]).map(({ name }) => name)).toEqual([
        "닫힌파일",
        "편집중",
      ]);
      const excludedExtension = await client.request("workspace/symbol", { query: "제외확장자" });
      expect(excludedExtension.result).toEqual([]);

      await writeFile(closedPath, "함수 디스크갱신() -> 정수 { 반환 4 }");
      const refreshed = await client.request("workspace/symbol", { query: "디스크갱신" });
      expect((refreshed.result as { name: string }[]).map(({ name }) => name)).toEqual([
        "디스크갱신",
      ]);
      await writeFile(join(sourceDirectory, "added.geul"), "함수 새파일() -> 없음 { }");
      const added = await client.request("workspace/symbol", { query: "새파일" });
      expect((added.result as { name: string }[]).map(({ name }) => name)).toEqual(["새파일"]);

      client.notification("textDocument/didClose", { textDocument: { uri: editableUri } });
      const closedBuffer = await client.request("workspace/symbol", { query: "저장된이름" });
      expect((closedBuffer.result as { name: string }[]).map(({ name }) => name)).toEqual([
        "저장된이름",
      ]);
      const removed = await client.request("workspace/symbol", { query: "편집중" });
      expect(removed.result).toEqual([]);

      await rm(closedPath);
      const deleted = await client.request("workspace/symbol", { query: "디스크갱신" });
      expect(deleted.result).toEqual([]);
      const ignored = await client.request("workspace/symbol", { query: "제외대상" });
      expect(ignored.result).toEqual([]);
    } finally {
      await client.close();
      await rm(root, { recursive: true, force: true });
      await rm(linkedSource, { recursive: true, force: true });
    }
  });

  it("uses rootUri when workspaceFolders is empty and isolates unreadable files", async () => {
    const root = await mkdtemp(join(tmpdir(), "geulion-lsp-root-"));
    const client = new LspClient();
    try {
      await writeFile(join(root, "valid.geul"), "함수 정상() -> 정수 { 반환 1 }");
      await writeFile(join(root, "invalid.geul"), Buffer.from([0xff]));
      const response = await client.request("initialize", {
        capabilities: {},
        rootUri: pathToFileURL(root).toString(),
        workspaceFolders: [{ uri: "untitled:untitled-1", name: "Untitled" }],
      });
      expect(response.error).toBeUndefined();
      client.notification("initialized");

      const result = await client.request("workspace/symbol", { query: "" });
      expect((result.result as { name: string }[]).map(({ name }) => name)).toEqual(["정상"]);
    } finally {
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("updates closed-file symbols as workspace folders are added and removed", async () => {
    const roots = await Promise.all(
      ["fallback", "added", "replacement"].map(() =>
        mkdtemp(join(tmpdir(), "geulion-lsp-folder-change-")),
      ),
    );
    const [fallbackRoot, addedRoot, replacementRoot] = roots;
    if (!fallbackRoot || !addedRoot || !replacementRoot) throw new Error("missing test root");
    const client = new LspClient();
    try {
      await writeFile(join(fallbackRoot, "fallback.geul"), "함수 이전워크스페이스() -> 없음 { }");
      await writeFile(join(addedRoot, "added.geul"), "함수 추가된워크스페이스() -> 없음 { }");
      await writeFile(
        join(replacementRoot, "replacement.geul"),
        "함수 교체워크스페이스() -> 없음 { }",
      );
      const initialized = await client.request("initialize", {
        capabilities: {},
        rootUri: pathToFileURL(fallbackRoot).toString(),
      });
      const capabilities = (initialized.result as { capabilities: Record<string, unknown> })
        .capabilities;
      expect(capabilities.workspace).toEqual({
        workspaceFolders: { supported: true, changeNotifications: true },
      });
      client.notification("initialized");

      const beforeChange = await client.request("workspace/symbol", { query: "" });
      expect((beforeChange.result as { name: string }[]).map(({ name }) => name)).toEqual([
        "이전워크스페이스",
      ]);

      const addedUri = pathToFileURL(addedRoot).toString();
      client.notification("workspace/didChangeWorkspaceFolders", {
        event: { added: [{ uri: addedUri, name: "Added" }], removed: [] },
      });
      const afterAdd = await client.request("workspace/symbol", { query: "" });
      expect((afterAdd.result as { name: string }[]).map(({ name }) => name)).toEqual([
        "추가된워크스페이스",
      ]);

      const addedDocumentUri = pathToFileURL(join(addedRoot, "added.geul")).toString();
      client.notification("textDocument/didOpen", {
        textDocument: {
          uri: addedDocumentUri,
          languageId: "geulion",
          version: 1,
          text: "함수 열린파일() -> 없음 { }",
        },
      });
      const replacementUri = pathToFileURL(replacementRoot).toString();
      client.notification("workspace/didChangeWorkspaceFolders", {
        event: {
          added: [{ uri: replacementUri, name: "Replacement" }],
          removed: [{ uri: addedUri, name: "Added" }],
        },
      });
      const afterRemove = await client.request("workspace/symbol", { query: "" });
      expect((afterRemove.result as { name: string }[]).map(({ name }) => name)).toEqual([
        "교체워크스페이스",
      ]);
    } finally {
      await client.close();
      await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    }
  });

  it("searches symbols across open documents and refreshes results after changes and close", async () => {
    const client = new LspClient();
    try {
      const initialized = await client.request("initialize", { capabilities: {} });
      expect(
        (initialized.result as { capabilities: Record<string, unknown> }).capabilities
          .workspaceSymbolProvider,
      ).toBe(true);
      client.notification("initialized");

      const firstUri = "file:///workspace/first.geul";
      const secondUri = "file:///workspace/second.geul";
      const firstText = "함수 가나다() -> 정수 { 반환 1 }\n함수 시작() -> 없음 { 출력(가나다()) }";
      const secondText = "함수 나무() -> 정수 { 반환 2 }";
      client.notificationBatch(
        {
          method: "textDocument/didOpen",
          params: {
            textDocument: { uri: secondUri, languageId: "geulion", version: 1, text: secondText },
          },
        },
        {
          method: "textDocument/didOpen",
          params: {
            textDocument: { uri: firstUri, languageId: "geulion", version: 1, text: firstText },
          },
        },
      );

      const allSymbols = await client.request("workspace/symbol", { query: "" });
      const symbols = allSymbols.result as {
        name: string;
        kind: number;
        location: { uri: string; range: { start: { line: number; character: number } } };
      }[];
      expect(symbols.map(({ name }) => name)).toEqual(["가나다", "나무", "시작"]);
      expect(symbols.map(({ kind }) => kind)).toEqual([12, 12, 12]);
      expect(symbols[0]?.location).toMatchObject({
        uri: firstUri,
        range: { start: { line: 0, character: 0 } },
      });
      expect(symbols[1]?.location).toMatchObject({
        uri: secondUri,
        range: { start: { line: 0, character: 0 } },
      });

      const matches = await client.request("workspace/symbol", { query: "나무" });
      expect((matches.result as { name: string }[]).map(({ name }) => name)).toEqual(["나무"]);

      const updatedText = "함수 다리() -> 정수 { 반환 3 }";
      client.notification("textDocument/didChange", {
        textDocument: { uri: secondUri, version: 2 },
        contentChanges: [{ text: updatedText }],
      });
      const removed = await client.request("workspace/symbol", { query: "나무" });
      expect(removed.result).toEqual([]);
      const updated = await client.request("workspace/symbol", { query: "다리" });
      expect(updated.result).toMatchObject([
        { name: "다리", location: { uri: secondUri, range: { start: { line: 0 } } } },
      ]);

      client.notification("textDocument/didClose", { textDocument: { uri: firstUri } });
      const afterClose = await client.request("workspace/symbol", { query: "" });
      expect(afterClose.result).toMatchObject([{ name: "다리", location: { uri: secondUri } }]);
    } finally {
      await client.close();
    }
  });

  it("sorts duplicate workspace symbols by URI and declaration position", async () => {
    const client = new LspClient();
    try {
      await client.request("initialize", { capabilities: {} });
      client.notification("initialized");
      const zUri = "file:///workspace/z.geul";
      const aUri = "file:///workspace/a.geul";
      client.notificationBatch(
        {
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: zUri,
              languageId: "geulion",
              version: 1,
              text: "함수 중복() -> 정수 { 반환 2 }",
            },
          },
        },
        {
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: aUri,
              languageId: "geulion",
              version: 1,
              text: "함수 중복() -> 정수 { 반환 1 }\n함수 중복() -> 정수 { 반환 2 }",
            },
          },
        },
      );

      const response = await client.request("workspace/symbol", { query: "중복" });
      const symbols = response.result as {
        name: string;
        location: { uri: string; range: { start: { line: number } } };
      }[];
      expect(symbols.map(({ location }) => [location.uri, location.range.start.line])).toEqual([
        [aUri, 0],
        [aUri, 1],
        [zUri, 0],
      ]);
    } finally {
      await client.close();
    }
  });

  it.each([
    ["missing Content-Length", "X-Trace: test\r\n\r\n"],
    ["duplicate Content-Length", "Content-Length: 2\r\ncontent-length: 2\r\n\r\n{}"],
    ["invalid Content-Length", "Content-Length: 2x\r\n\r\n{}"],
    ["negative Content-Length", "Content-Length: -1\r\n\r\n"],
    ["non-ASCII header", "Content-Length: 2\r\nX-Note: 가\r\n\r\n{}"],
  ])("rejects %s with a non-zero exit and no stdout", async (_name, frame) => {
    const client = new LspClient();
    client.sendRaw(frame);
    client.endInput();
    const result = await client.waitForExit();
    expect(result.code).not.toBe(0);
    expect(result.stdout).toHaveLength(0);
    expect(result.stderr.toString("utf8")).toContain("LSP");
  });

  it.each([
    ["oversized header", `X-Trace: ${"x".repeat(8193)}`],
    ["oversized body", `Content-Length: ${16 * 1024 * 1024 + 1}\r\n\r\n`],
  ])("bounds an %s", async (_name, prefix) => {
    const client = new LspClient();
    client.sendRaw(prefix);
    client.endInput();
    const result = await client.waitForExit();
    expect(result.code).not.toBe(0);
    expect(result.stdout).toHaveLength(0);
  });

  it.each([
    ["truncated header", "Content-Length: 20\r\n"],
    ["truncated body", "Content-Length: 20\r\n\r\n{}"],
  ])("reports a %s at EOF", async (_name, frame) => {
    const client = new LspClient();
    client.sendRaw(frame);
    client.endInput();
    const result = await client.waitForExit();
    expect(result.code).not.toBe(0);
    expect(result.stderr.toString("utf8")).toContain("Unexpected end of input");
    expect(result.stdout).toHaveLength(0);
  });

  it("recovers from malformed JSON and invalid UTF-8 when their frame lengths are known", async () => {
    const client = new LspClient();
    try {
      const invalidUtf8 = Buffer.from([0xff, 0xfe]);
      const invalidUtf8Frame = Buffer.concat([
        Buffer.from(`Content-Length: ${invalidUtf8.length}\r\n\r\n`),
        invalidUtf8,
      ]);
      const validFrame = Buffer.from(
        `Content-Length: ${Buffer.byteLength('{"jsonrpc":"2.0","id":7,"method":"initialize","params":{}}')}\r\n\r\n{"jsonrpc":"2.0","id":7,"method":"initialize","params":{}}`,
      );
      client.sendRaw(Buffer.concat([invalidUtf8Frame, validFrame]));
      const parseError = await client.waitFor((message) => message.id === null);
      expect((parseError.error as { code: number }).code).toBe(-32700);
      const initialized = await client.waitFor((message) => message.id === 7);
      expect(initialized.result).toHaveProperty("capabilities");
      client.notification("initialized");
    } finally {
      await client.close();
    }
  });

  it("rejects invalid JSON-RPC envelopes and enforces initialize/shutdown ordering", async () => {
    const client = new LspClient();
    try {
      client.sendBatch([
        { jsonrpc: "1.0", id: 1, method: "initialize" },
        { jsonrpc: "2.0", id: 2, method: "initialize", params: "invalid" },
        { jsonrpc: "2.0", id: 3, method: 42 },
      ]);
      for (const id of [1, 2, 3]) {
        const response = await client.waitFor((message) => message.id === id);
        expect((response.error as { code: number }).code).toBe(-32600);
      }

      const notInitialized = await client.request("textDocument/completion");
      expect((notInitialized.error as { code: number }).code).toBe(-32002);
      client.notification("workspace/unknownNotification");

      const initialized = await client.request("initialize", { capabilities: {} });
      expect(initialized.result).toHaveProperty("capabilities");
      const premature = await client.request("textDocument/completion");
      expect((premature.error as { code: number }).code).toBe(-32002);
      const readyRequestId = 5;
      client.sendBatch([
        { jsonrpc: "2.0", method: "initialized" },
        {
          jsonrpc: "2.0",
          id: readyRequestId,
          method: "textDocument/completion",
          params: {},
        },
      ]);
      const ready = await client.waitFor((message) => message.id === readyRequestId);
      expect(ready.result).toEqual([]);
      const shutdown = await client.request("shutdown");
      expect(shutdown.result).toBeNull();
      const afterShutdown = await client.request("textDocument/completion");
      expect((afterShutdown.error as { code: number }).code).toBe(-32600);
      const reinitialize = await client.request("initialize", { capabilities: {} });
      expect((reinitialize.error as { code: number }).code).toBe(-32600);
      client.notification("textDocument/didOpen", {
        textDocument: { uri: "file:///ignored.geul", version: 1, text: "malformed" },
      });
      client.notification("exit");
      client.endInput();
      const result = await client.waitForExit();
      expect(result.code).toBe(0);
    } catch (error) {
      client.child.kill();
      throw error;
    }
  });

  it("serves lifecycle, diagnostics, and compiler-backed editor features over stdio", async () => {
    const client = new LspClient();
    try {
      const initialized = await client.request("initialize", {
        processId: process.pid,
        rootUri: null,
        capabilities: {
          general: { positionEncodings: ["utf-16", "utf-8"] },
          textDocument: { completion: { completionItem: { snippetSupport: true } } },
        },
      });
      const result = initialized.result as { capabilities: Record<string, unknown> };
      expect(result.capabilities.positionEncoding).toBe("utf-16");
      expect(result.capabilities.renameProvider).toEqual({ prepareProvider: true });
      expect(result.capabilities.codeActionProvider).toEqual({ codeActionKinds: ["quickfix"] });
      for (const provider of [
        "textDocumentSync",
        "completionProvider",
        "signatureHelpProvider",
        "hoverProvider",
        "definitionProvider",
        "documentHighlightProvider",
        "documentSymbolProvider",
        "foldingRangeProvider",
        "referencesProvider",
      ])
        expect(result.capabilities).toHaveProperty(provider);
      client.notification("initialized");

      const uri = "file:///workspace/main.geul";
      const text =
        '함수 인사(이름: 문자열) -> 문자열 { 반환 이름 }\n함수 시작() -> 없음 { 출력(인사("가")) }';
      client.notificationBatch({
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "geulion", version: 1, text } },
      });
      const openedDiagnostics = await client.waitFor((message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { version?: number };
        return params.version === 1;
      });
      expect((openedDiagnostics.params as { diagnostics: unknown[] }).diagnostics).toEqual([]);
      const symbols = await client.request("textDocument/documentSymbol", {
        textDocument: { uri },
      });
      expect((symbols.result as { name: string }[]).map((symbol) => symbol.name)).toEqual([
        "인사",
        "시작",
      ]);

      const definition = await client.request("textDocument/definition", {
        textDocument: { uri },
        position: {
          line: 1,
          character: text.slice(text.indexOf("\n") + 1).indexOf("인사("),
        },
      });
      expect(
        (definition.result as { range: { start: { line: number; character: number } } }).range
          .start,
      ).toEqual({ line: 0, character: 3 });

      const hover = await client.request("textDocument/hover", {
        textDocument: { uri },
        position: { line: 0, character: 4 },
      });
      expect(JSON.stringify(hover.result)).toContain("인사");

      const signature = await client.request("textDocument/signatureHelp", {
        textDocument: { uri },
        position: { line: 1, character: text.slice(text.indexOf("\n") + 1).indexOf("출력(") + 4 },
      });
      expect(
        (signature.result as { signatures: { label: string }[] }).signatures[0]?.label,
      ).toContain("출력(");

      const references = await client.request("textDocument/references", {
        textDocument: { uri },
        position: { line: 0, character: 3 },
        context: { includeDeclaration: false },
      });
      expect((references.result as unknown[]).length).toBe(1);

      const prepared = await client.request("textDocument/prepareRename", {
        textDocument: { uri },
        position: { line: 0, character: 3 },
      });
      expect((prepared.result as { placeholder: string }).placeholder).toBe("인사");

      const renamed = await client.request("textDocument/rename", {
        textDocument: { uri },
        position: { line: 0, character: 3 },
        newName: "환영",
      });
      expect((renamed.result as { changes: Record<string, unknown[]> }).changes[uri]).toHaveLength(
        2,
      );

      const completion = await client.request("textDocument/completion", {
        textDocument: { uri },
        position: { line: 1, character: 6 },
      });
      const completionLabels = (completion.result as { items: { label: string }[] }).items.map(
        (item) => item.label,
      );
      expect(completionLabels).toContain("함수");
      expect(completionLabels).toContain("출력");
      const outputCompletion = (
        completion.result as {
          items: { label: string; insertText?: string; insertTextFormat?: number }[];
        }
      ).items.find((item) => item.label === "출력");
      expect(outputCompletion?.insertText).toBe("출력(${1:값})");
      expect(outputCompletion?.insertTextFormat).toBe(2);

      const diagnosticsDocument = '함수 시작() -> 없음 {\n  출력("😀" + 없는값)\n}';
      client.notification("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: diagnosticsDocument }],
      });
      // The server publishes diagnostics as a notification after applying the edit.
      const diagnostics = await client.waitFor((message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { version?: number };
        return params.version === 2;
      });
      const diagnosticParams = diagnostics.params as {
        version: number;
        diagnostics: { code: string; range: { start: { line: number; character: number } } }[];
      };
      expect(diagnosticParams.version).toBe(2);
      const unresolved = diagnosticParams.diagnostics.find(
        (diagnostic) => diagnostic.code === "GE2001",
      );
      expect(unresolved?.range.start).toEqual({ line: 1, character: 12 });

      client.notification("textDocument/didChange", {
        textDocument: { uri, version: 3 },
        contentChanges: [{ text: "함수 시작() -> 없음 {}" }],
      });
      const cleared = await client.waitFor((message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { version?: number };
        return params.version === 3;
      });
      expect((cleared.params as { diagnostics: unknown[] }).diagnostics).toEqual([]);

      client.notification("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: "잘못된 이전 내용" }],
      });
      const latestSymbols = await client.request("textDocument/documentSymbol", {
        textDocument: { uri },
      });
      expect((latestSymbols.result as { name: string }[]).map((symbol) => symbol.name)).toEqual([
        "시작",
      ]);

      client.sendBatch([
        {
          jsonrpc: "2.0",
          id: 99,
          method: "textDocument/documentSymbol",
          params: { textDocument: { uri } },
        },
        { jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 99 } },
      ]);
      const cancelled = await client.waitFor((message) => message.id === 99);
      expect((cancelled.error as { code: number }).code).toBe(-32800);

      client.sendRawBatch([
        "{invalid json",
        JSON.stringify({
          jsonrpc: "2.0",
          id: 100,
          method: "textDocument/documentSymbol",
          params: { textDocument: { uri } },
        }),
      ]);
      const parseError = await client.waitFor((message) => message.id === null);
      expect((parseError.error as { code: number }).code).toBe(-32700);
      const afterMalformed = await client.waitFor((message) => message.id === 100);
      expect((afterMalformed.result as { name: string }[]).map((symbol) => symbol.name)).toEqual([
        "시작",
      ]);

      const unsupported = await client.request("textDocument/notSupported");
      expect((unsupported.error as { code: number }).code).toBe(-32601);

      client.notification("textDocument/didClose", { textDocument: { uri } });
      const closed = await client.waitFor((message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        return (message.params as { uri?: string }).uri === uri;
      });
      expect((closed.params as { diagnostics: unknown[] }).diagnostics).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("offers only the safe entrypoint-name quick fix for matching compiler diagnostics", async () => {
    const client = new LspClient();
    try {
      const initialized = await client.request("initialize", {
        capabilities: { general: { positionEncodings: ["utf-8"] } },
      });
      const capabilities = (initialized.result as { capabilities: Record<string, unknown> })
        .capabilities;
      expect(capabilities.codeActionProvider).toEqual({ codeActionKinds: ["quickfix"] });
      client.notification("initialized");

      const uri = "file:///workspace/fix.geul";
      const text = "함수 보조기능() -> 없음 { }";
      client.notification("textDocument/didOpen", {
        textDocument: { uri, languageId: "geulion", version: 7, text },
      });
      const published = await client.waitFor((message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        const params = message.params as { uri?: string; version?: number };
        return params.uri === uri && params.version === 7;
      });
      const diagnostics = (published.params as { diagnostics: Record<string, unknown>[] })
        .diagnostics;
      expect(diagnostics).toHaveLength(1);
      const actions = await client.request("textDocument/codeAction", {
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
        context: { diagnostics },
      });
      expect(actions.result).toEqual([
        {
          title: "진입 함수 이름을 '시작'으로 바꾸기",
          kind: "quickfix",
          diagnostics: [diagnostics[0]],
          edit: {
            documentChanges: [
              {
                textDocument: { uri, version: 7 },
                edits: [
                  {
                    range: {
                      start: { line: 0, character: 7 },
                      end: { line: 0, character: 19 },
                    },
                    newText: "시작",
                  },
                ],
              },
            ],
          },
        },
      ]);
      const unmatched = await client.request("textDocument/codeAction", {
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
        context: { diagnostics: [{ ...diagnostics[0], code: "GE2001" }] },
      });
      expect(unmatched.result).toEqual([]);
      const missing = await client.request("textDocument/codeAction", {
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
        context: { diagnostics: [] },
      });
      expect(missing.result).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it.each([
    { languageVersion: "0.3", snippetSupport: true, expected: true, name: "v0.3 snippets" },
    { languageVersion: "0.3", snippetSupport: false, expected: true, name: "v0.3 plain text" },
    { languageVersion: "0.1", snippetSupport: true, expected: false, name: "v0.1" },
    { languageVersion: "0.2", snippetSupport: true, expected: false, name: "v0.2" },
  ])("offers the public-function completion for $name clients", async (scenario) => {
    const client = new LspClient();
    const uri = "file:///workspace/completion.geul";
    try {
      await openEditorDocument(client, {
        languageVersion: scenario.languageVersion,
        snippetSupport: scenario.snippetSupport,
        uri,
        text: "함수 시작() -> 없음 { 출력(1) }",
      });

      const response = await client.request("textDocument/completion", {
        textDocument: { uri },
        position: { line: 0, character: 0 },
      });
      const item = (
        response.result as {
          items: { label: string; insertText?: string; insertTextFormat?: number }[];
        }
      ).items.find(({ label }) => label === "공개 함수");
      expect(item !== undefined).toBe(scenario.expected);
      if (item) {
        expect(item.insertText).toContain("공개 함수");
        expect(item.insertTextFormat).toBe(scenario.snippetSupport ? 2 : undefined);
        if (scenario.snippetSupport) {
          expect(item.insertText).toContain("${1:이름}");
          expect(item.insertText).toContain("-> ${2:없음}");
        } else {
          expect(item.insertText).toContain("-> 없음");
          expect(item.insertText).toContain("이름()");
        }
      }
    } finally {
      await client.close();
    }
  });

  it("suppresses completion in comments and strings, including after escaped quotes", async () => {
    const client = new LspClient();
    const uri = "file:///workspace/completion-context.geul";
    const text = '# 함수 주석\n함수 시작() -> 없음 { 출력("함수 내용") }';
    const codeLine = text.split("\n")[1] ?? "";
    const escapedText = '함수 시작() -> 없음 { 출력("문장 \\"안쪽\\" 함수") }';
    try {
      await openEditorDocument(client, {
        languageVersion: "0.3",
        snippetSupport: true,
        uri,
        text,
      });
      const request = (position: { line: number; character: number }) =>
        client.request("textDocument/completion", { textDocument: { uri }, position });

      const comment = await request({ line: 0, character: 4 });
      expect((comment.result as { items: unknown[] }).items).toEqual([]);

      const string = await request({
        line: 1,
        character: codeLine.indexOf("함수 내용") + 3,
      });
      expect((string.result as { items: unknown[] }).items).toEqual([]);

      const code = await request({ line: 1, character: 6 });
      expect((code.result as { items: { label: string }[] }).items.length).toBeGreaterThan(0);

      client.notification("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: escapedText }],
      });
      const escapedString = await request({
        line: 0,
        character: escapedText.indexOf("안쪽") + 1,
      });
      expect((escapedString.result as { items: unknown[] }).items).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it.each(["utf-8", "utf-16", "utf-32"] as const)(
    "returns semantic document highlights using %s positions and current buffers",
    async (encoding) => {
      const client = new LspClient();
      const uri = `file:///workspace/highlight-${encoding}.geul`;
      const text =
        '함수 인사(이름: 문자열) -> 문자열 { 반환 이름 }\n함수 시작() -> 없음 { 출력(인사("가")) }';
      const lines = text.split("\n");
      const declarationLine = lines[0] ?? "";
      const callLine = lines[1] ?? "";
      const encodedLength = (value: string) =>
        encoding === "utf-8"
          ? Buffer.byteLength(value, "utf8")
          : encoding === "utf-32"
            ? [...value].length
            : value.length;
      try {
        const initialized = await client.request("initialize", {
          capabilities: { general: { positionEncodings: [encoding] } },
        });
        expect(
          (initialized.result as { capabilities: Record<string, unknown> }).capabilities
            .positionEncoding,
        ).toBe(encoding);
        client.notification("initialized");
        client.notification("textDocument/didOpen", {
          textDocument: { uri, languageId: "geulion", version: 1, text },
        });

        const functionStart = callLine.indexOf("인사(");
        const functionHighlights = await client.request("textDocument/documentHighlight", {
          textDocument: { uri },
          position: {
            line: 1,
            character: encodedLength(callLine.slice(0, functionStart)),
          },
        });
        expect(
          (
            functionHighlights.result as {
              range: {
                start: { line: number; character: number };
                end: { line: number; character: number };
              };
            }[]
          ).map(({ range }) => range),
        ).toEqual([
          {
            start: {
              line: 0,
              character: encodedLength(declarationLine.slice(0, declarationLine.indexOf("인사"))),
            },
            end: {
              line: 0,
              character: encodedLength(
                declarationLine.slice(0, declarationLine.indexOf("인사")) + "인사",
              ),
            },
          },
          {
            start: { line: 1, character: encodedLength(callLine.slice(0, functionStart)) },
            end: { line: 1, character: encodedLength(callLine.slice(0, functionStart) + "인사") },
          },
        ]);

        const parameterStart = declarationLine.indexOf("이름");
        const parameterHighlights = await client.request("textDocument/documentHighlight", {
          textDocument: { uri },
          position: { line: 0, character: encodedLength(declarationLine.slice(0, parameterStart)) },
        });
        expect(parameterHighlights.result as unknown[]).toHaveLength(2);

        const unknown = await client.request("textDocument/documentHighlight", {
          textDocument: { uri },
          position: {
            line: 0,
            character: encodedLength(
              declarationLine.indexOf("반환") >= 0
                ? declarationLine.slice(0, declarationLine.indexOf("반환"))
                : "",
            ),
          },
        });
        expect(unknown.result).toEqual([]);

        client.notification("textDocument/didChange", {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text: "함수 시작() -> 없음 { 출력(1) }" }],
        });
        const changed = await client.request("textDocument/documentHighlight", {
          textDocument: { uri },
          position: { line: 0, character: 0 },
        });
        expect(changed.result).toEqual([]);
        client.notification("textDocument/didClose", { textDocument: { uri } });
        const closed = await client.request("textDocument/documentHighlight", {
          textDocument: { uri },
          position: { line: 0, character: 0 },
        });
        expect(closed.result).toEqual([]);
      } finally {
        await client.close();
      }
    },
  );

  it.each(["utf-8", "utf-16", "utf-32"] as const)(
    "returns multiline function folding ranges using %s positions",
    async (encoding) => {
      const client = new LspClient();
      const uri = `file:///workspace/folding-${encoding}.geul`;
      const text =
        "함수 한줄() -> 없음 { 출력(1) }\n함수 여러줄() -> 없음 {\n출력(1)\n}\n함수 시작() -> 없음 {\n여러줄()\n}";
      try {
        const initialized = await client.request("initialize", {
          capabilities: { general: { positionEncodings: [encoding] } },
        });
        const capabilities = (initialized.result as { capabilities: Record<string, unknown> })
          .capabilities;
        expect(capabilities.positionEncoding).toBe(encoding);
        expect(capabilities.foldingRangeProvider).toBe(true);
        client.notification("initialized");
        client.notification("textDocument/didOpen", {
          textDocument: { uri, languageId: "geulion", version: 1, text },
        });

        const ranges = await client.request("textDocument/foldingRange", {
          textDocument: { uri },
        });
        expect(ranges.result).toEqual([
          {
            startLine: 1,
            startCharacter: 0,
            endLine: 3,
            endCharacter: 1,
            kind: "region",
          },
          {
            startLine: 4,
            startCharacter: 0,
            endLine: 6,
            endCharacter: 1,
            kind: "region",
          },
        ]);

        client.notification("textDocument/didChange", {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text: "함수 시작() -> 없음 { 출력(1) }" }],
        });
        const changed = await client.request("textDocument/foldingRange", {
          textDocument: { uri },
        });
        expect(changed.result).toEqual([]);

        client.notification("textDocument/didChange", {
          textDocument: { uri, version: 3 },
          contentChanges: [{ text: "함수 시작() -> 없음 {" }],
        });
        const invalid = await client.request("textDocument/foldingRange", {
          textDocument: { uri },
        });
        expect(invalid.result).toEqual([]);
        client.notification("textDocument/didClose", { textDocument: { uri } });
        const closed = await client.request("textDocument/foldingRange", {
          textDocument: { uri },
        });
        expect(closed.result).toEqual([]);
      } finally {
        await client.close();
      }
    },
  );

  it.each(["utf-8", "utf-16", "utf-32"] as const)(
    "returns semantic token ranges using %s positions and current buffers",
    async (encoding) => {
      const client = new LspClient();
      const uri = `file:///workspace/semantic-tokens-${encoding}.geul`;
      const text =
        '\uFEFF// 😀 line\r\n함수 시작() -> 없음 {\r\n  변수 값: 문자열 = "가//😀" /* 앞\r\n  // 안쪽\r\n  뒤 */\r\n  변수 숫자: 정수 = 42\r\n  반환\r\n}\r\n"unterminated\\\r\n// after invalid string';
      const encodedLength = (value: string) =>
        encoding === "utf-8"
          ? Buffer.byteLength(value, "utf8")
          : encoding === "utf-32"
            ? [...value].length
            : value.length;
      const lines = text.split(/\r\n|\r|\n/u);
      const tokenTypeNames = ["keyword", "string", "number", "operator", "punctuation", "comment"];
      const tokenText = (lineIndex: number, start: number, length: number) => {
        const line = lines[lineIndex] ?? "";
        let offset = 0;
        let value = "";
        for (const character of line) {
          const width = encodedLength(character);
          if (offset >= start && offset + width <= start + length) value += character;
          offset += width;
        }
        return value;
      };
      try {
        const initialized = await client.request("initialize", {
          capabilities: { general: { positionEncodings: [encoding] } },
        });
        const capabilities = (initialized.result as { capabilities: Record<string, unknown> })
          .capabilities;
        expect(capabilities.positionEncoding).toBe(encoding);
        expect(capabilities.semanticTokensProvider).toEqual({
          legend: { tokenTypes: tokenTypeNames, tokenModifiers: [] },
          full: { delta: true },
        });
        client.notification("initialized");
        client.notification("textDocument/didOpen", {
          textDocument: { uri, languageId: "geulion", version: 1, text },
        });

        const response = await client.request("textDocument/semanticTokens/full", {
          textDocument: { uri },
        });
        const initial = response.result as { resultId: string; data: number[] };
        const data = initial.data;
        expect(initial.resultId).toEqual(expect.any(String));
        expect(data.length % 5).toBe(0);
        const decoded: { line: number; character: number; text: string; type: string }[] = [];
        let line = 0;
        let character = 0;
        for (let index = 0; index < data.length; index += 5) {
          const deltaLine = data[index] ?? 0;
          const deltaCharacter = data[index + 1] ?? 0;
          line += deltaLine;
          character = deltaLine === 0 ? character + deltaCharacter : deltaCharacter;
          const length = data[index + 2] ?? 0;
          const type = tokenTypeNames[data[index + 3] ?? -1];
          expect(type).toBeDefined();
          expect(data[index + 4]).toBe(0);
          decoded.push({
            line,
            character,
            text: tokenText(line, character, length),
            type: type ?? "",
          });
        }
        expect(decoded).toEqual(
          expect.arrayContaining([
            {
              line: 0,
              character: encodedLength("\uFEFF"),
              text: "// 😀 line",
              type: "comment",
            },
            { line: 1, character: 0, text: "함수", type: "keyword" },
            { line: 1, character: encodedLength("함수 시작"), text: "(", type: "punctuation" },
            { line: 1, character: encodedLength("함수 시작() "), text: "->", type: "operator" },
            { line: 1, character: encodedLength("함수 시작() -> "), text: "없음", type: "keyword" },
            { line: 2, character: encodedLength("  "), text: "변수", type: "keyword" },
            { line: 2, character: encodedLength("  변수 값: "), text: "문자열", type: "keyword" },
            {
              line: 2,
              character: encodedLength("  변수 값: 문자열 = "),
              text: '"가//😀"',
              type: "string",
            },
            {
              line: 2,
              character: encodedLength('  변수 값: 문자열 = "가//😀" '),
              text: "/* 앞",
              type: "comment",
            },
            { line: 3, character: 0, text: "  // 안쪽", type: "comment" },
            { line: 4, character: 0, text: "  뒤 */", type: "comment" },
            {
              line: 5,
              character: encodedLength("  변수 숫자: 정수 = "),
              text: "42",
              type: "number",
            },
            { line: 9, character: 0, text: "// after invalid string", type: "comment" },
          ]),
        );

        const unchangedDelta = await client.request("textDocument/semanticTokens/full/delta", {
          textDocument: { uri },
          previousResultId: initial.resultId,
        });
        expect(unchangedDelta.result).toMatchObject({ edits: [] });

        client.notification("textDocument/didChange", {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text: "함수 시작() -> 없음 { 출력(7) }" }],
        });
        const changed = await client.request("textDocument/semanticTokens/full/delta", {
          textDocument: { uri },
          previousResultId: initial.resultId,
        });
        const changedResult = changed.result as {
          resultId: string;
          edits: { start: number; deleteCount: number; data?: number[] }[];
        };
        expect(changedResult.resultId).toEqual(expect.any(String));
        expect(changedResult.edits).toHaveLength(1);
        const reconstructed = [...data];
        for (const edit of [...changedResult.edits].reverse())
          reconstructed.splice(edit.start, edit.deleteCount, ...(edit.data ?? []));
        const current = await client.request("textDocument/semanticTokens/full", {
          textDocument: { uri },
        });
        const currentResult = current.result as { resultId: string; data: number[] };
        const currentData = currentResult.data;
        expect(currentData).not.toEqual(data);
        expect(reconstructed).toEqual(currentData);

        client.notification("textDocument/didChange", {
          textDocument: { uri, version: 3 },
          contentChanges: [{ text: "함수 시작() -> 없음 { 출력(7) }\n// appended" }],
        });
        const insertion = await client.request("textDocument/semanticTokens/full/delta", {
          textDocument: { uri },
          previousResultId: currentResult.resultId,
        });
        const insertionResult = insertion.result as {
          resultId: string;
          edits: { start: number; deleteCount: number; data?: number[] }[];
        };
        expect(insertionResult.edits).toHaveLength(1);
        expect(insertionResult.edits[0]?.deleteCount).toBe(0);
        expect(insertionResult.edits[0]?.data?.length).toBeGreaterThan(0);

        client.notification("textDocument/didChange", {
          textDocument: { uri, version: 4 },
          contentChanges: [{ text: "함수 시작() -> 없음 { 출력(7) }" }],
        });
        const deletion = await client.request("textDocument/semanticTokens/full/delta", {
          textDocument: { uri },
          previousResultId: insertionResult.resultId,
        });
        const deletionResult = deletion.result as {
          edits: { start: number; deleteCount: number; data?: number[] }[];
        };
        expect(deletionResult.edits).toHaveLength(1);
        expect(deletionResult.edits[0]?.deleteCount).toBeGreaterThan(0);
        expect(deletionResult.edits[0]?.data).toEqual([]);

        const unknownId = await client.request("textDocument/semanticTokens/full/delta", {
          textDocument: { uri },
          previousResultId: "expired-result-id",
        });
        expect(unknownId.result).toMatchObject({ data: currentData });
        expect(unknownId.result).not.toHaveProperty("edits");

        const otherUri = `${uri}-other`;
        client.notification("textDocument/didOpen", {
          textDocument: {
            uri: otherUri,
            languageId: "geulion",
            version: 1,
            text: "함수 보조() -> 없음 { 출력(1) }",
          },
        });
        const otherDocumentDelta = await client.request("textDocument/semanticTokens/full/delta", {
          textDocument: { uri: otherUri },
          previousResultId: initial.resultId,
        });
        expect(otherDocumentDelta.result).toHaveProperty("data");
        expect(otherDocumentDelta.result).not.toHaveProperty("edits");
        client.notification("textDocument/didClose", { textDocument: { uri: otherUri } });

        for (let index = 0; index < 6; index += 1)
          await client.request("textDocument/semanticTokens/full", { textDocument: { uri } });
        const evictedId = await client.request("textDocument/semanticTokens/full/delta", {
          textDocument: { uri },
          previousResultId: initial.resultId,
        });
        expect(evictedId.result).toMatchObject({ data: currentData });
        expect(evictedId.result).not.toHaveProperty("edits");

        client.notification("textDocument/didClose", { textDocument: { uri } });
        const closed = await client.request("textDocument/semanticTokens/full", {
          textDocument: { uri },
        });
        expect(closed.result).toMatchObject({ data: [] });
        const closedDelta = await client.request("textDocument/semanticTokens/full/delta", {
          textDocument: { uri },
          previousResultId: currentResult.resultId,
        });
        expect(closedDelta.result).toMatchObject({ data: [] });
        expect(closedDelta.result).not.toHaveProperty("edits");
      } finally {
        await client.close();
      }
    },
  );

  it("returns keyword help and suppresses hover inside comments over stdio", async () => {
    const client = new LspClient();
    const uri = "file:///workspace/hover.geul";
    try {
      await openEditorDocument(client, {
        languageVersion: "0.3",
        snippetSupport: false,
        uri,
        text: "# 주석 함수\n함수 시작() -> 없음 { 출력(1) }",
      });

      const keywordHover = await client.request("textDocument/hover", {
        textDocument: { uri },
        position: { line: 1, character: 1 },
      });
      expect(JSON.stringify(keywordHover.result)).toContain("매개변수와 반환 타입");

      const commentHover = await client.request("textDocument/hover", {
        textDocument: { uri },
        position: { line: 0, character: 6 },
      });
      expect(commentHover.result).toBeNull();
    } finally {
      await client.close();
    }
  });

  it("suppresses keyword hover inside strings, including after escaped quotes", async () => {
    const client = new LspClient();
    const uri = "file:///workspace/string-hover.geul";
    const source = String.raw`함수 시작() -> 없음 { 출력("함수 \"함수\"") }`;
    try {
      await openEditorDocument(client, {
        languageVersion: "0.3",
        snippetSupport: false,
        uri,
        text: source,
      });

      const codeHover = await client.request("textDocument/hover", {
        textDocument: { uri },
        position: { line: 0, character: 1 },
      });
      expect(JSON.stringify(codeHover.result)).toContain("매개변수와 반환 타입");

      for (const character of ["함수 ".length, String.raw`함수 \"`.length + "함수".length]) {
        const stringHover = await client.request("textDocument/hover", {
          textDocument: { uri },
          position: { line: 0, character: source.indexOf('"') + 1 + character },
        });
        expect(stringHover.result).toBeNull();
      }
    } finally {
      await client.close();
    }
  });

  it("re-publishes diagnostics when a supported language version is selected", async () => {
    const client = new LspClient();
    try {
      await client.request("initialize", { capabilities: {} });
      client.notification("initialized");
      const uri = "file:///workspace/versioned.geul";
      client.notification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: "geulion",
          version: 1,
          text: '함수 시작() -> 없음 { 출력(문자열길이("가")) }',
        },
      });
      const oldVersion = await client.waitFor((message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        return (message.params as { version?: number }).version === 1;
      });
      expect((oldVersion.params as { diagnostics: { code: string }[] }).diagnostics).toContainEqual(
        expect.objectContaining({ code: "GE2001" }),
      );

      client.notification("workspace/didChangeConfiguration", {
        settings: { geulion: { languageVersion: "0.2" } },
      });
      const updatedVersion = await client.waitFor((message) => {
        if (message.method !== "textDocument/publishDiagnostics") return false;
        return (message.params as { version?: number }).version === 1;
      });
      expect((updatedVersion.params as { diagnostics: unknown[] }).diagnostics).toEqual([]);

      client.notification("workspace/didChangeConfiguration", {
        settings: { geulion: { languageVersion: "9.9" } },
      });
      const unchangedVersion = await client.request("textDocument/documentSymbol", {
        textDocument: { uri },
      });
      expect(unchangedVersion.result).toMatchObject([{ name: "시작" }]);
    } finally {
      await client.close();
    }
  });

  it.each([
    ["utf-8", 18],
    ["utf-32", 11],
  ] as const)(
    "negotiates %s positions for Korean and supplementary Unicode",
    async (encoding, expectedStart) => {
      const client = new LspClient();
      try {
        const initialized = await client.request("initialize", {
          processId: process.pid,
          rootUri: null,
          capabilities: { general: { positionEncodings: [encoding] } },
        });
        const result = initialized.result as { capabilities: Record<string, unknown> };
        expect(result.capabilities.positionEncoding).toBe(encoding);
        client.notification("initialized");

        const uri = `file:///workspace/${encoding}.geul`;
        const text = "함수 인사() -> 정수 { 반환 1 }\n함수 시작() -> 없음 { 출력(인사()) }";
        client.notificationBatch({
          method: "textDocument/didOpen",
          params: { textDocument: { uri, languageId: "geulion", version: 1, text } },
        });
        const secondLine = text.slice(text.indexOf("\n") + 1);
        const callCharacter = secondLine.indexOf("인사(");
        const prefix = secondLine.slice(0, callCharacter);
        const character =
          encoding === "utf-8" ? Buffer.byteLength(prefix, "utf8") : [...prefix].length;
        const definition = await client.request("textDocument/definition", {
          textDocument: { uri },
          position: { line: 1, character },
        });
        expect(
          (definition.result as { range: { start: { line: number; character: number } } }).range
            .start,
        ).toEqual({ line: 0, character: encoding === "utf-8" ? 7 : 3 });

        client.notification("textDocument/didChange", {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text: '함수 시작() -> 없음 {\n  출력("😀" + 없는값)\n}' }],
        });
        const diagnostics = await client.waitFor((message) => {
          if (message.method !== "textDocument/publishDiagnostics") return false;
          return (message.params as { version?: number }).version === 2;
        });
        const diagnostic = (
          diagnostics.params as {
            diagnostics: { code: string; range: { start: { line: number; character: number } } }[];
          }
        ).diagnostics.find((candidate) => candidate.code === "GE2001");
        expect(diagnostic?.range.start).toEqual({ line: 1, character: expectedStart });
      } finally {
        await client.close();
      }
    },
  );
});
