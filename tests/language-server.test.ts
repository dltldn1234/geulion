import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
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

describe("GEULION Language Server Protocol", () => {
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
      for (const provider of [
        "textDocumentSync",
        "completionProvider",
        "signatureHelpProvider",
        "hoverProvider",
        "definitionProvider",
        "documentSymbolProvider",
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

      const completion = await client.request("textDocument/completion", { textDocument: { uri } });
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
