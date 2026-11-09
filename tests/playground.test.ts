import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileSource } from "@geulion/compiler";
import {
  createSandboxWorkerSource,
  decodeSharedCode,
  encodeSharedCode,
  MAX_SHARED_BYTES,
  scheduleWorkerTimeout,
} from "../examples/playground/playground-core.js";

const playgroundDirectory = new URL("../examples/playground/", import.meta.url);
const exampleSource = readFileSync(new URL("examples/hello.geul", playgroundDirectory), "utf8");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GEULION browser playground", () => {
  it("round-trips Korean source in a bounded URL fragment", () => {
    const source = '공개 함수 인사() -> 없음 { 출력("안녕 🌱") }';
    expect(decodeSharedCode(encodeSharedCode(source))).toBe(source);
    expect(() => encodeSharedCode("a".repeat(MAX_SHARED_BYTES + 1))).toThrow(RangeError);
    expect(() => decodeSharedCode("#code=_w")).toThrow("UTF-8");
    expect(() => decodeSharedCode(`#code=${"a".repeat(MAX_SHARED_BYTES * 2)}`)).toThrow();
    expect(decodeSharedCode("#other=value")).toBeUndefined();
  });

  it("compiles and invokes the checked-in v0.3 example through the Worker ABI", async () => {
    const compiled = compileSource({
      path: "hello.geul",
      source: new TextEncoder().encode(exampleSource),
      target: "browser",
      languageVersion: "0.3",
    });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;

    let messageHandler: ((event: MessageEvent) => void) | undefined;
    const messages: unknown[] = [];
    vi.stubGlobal("self", {
      addEventListener(type: string, handler: (event: MessageEvent) => void) {
        if (type === "message") messageHandler = handler;
      },
    });
    vi.stubGlobal("postMessage", (message: unknown) => messages.push(message));

    const workerSource = createSandboxWorkerSource(compiled.code);
    await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`);
    expect(messages[0]).toMatchObject({ type: "ready", exports: [{ name: "인사" }] });
    messageHandler?.({ data: { type: "invoke", name: "인사", arguments: [] } } as MessageEvent);
    expect(messages).toContainEqual({ type: "output", text: "안녕하세요, GEULION!\n" });
    expect(messages).toContainEqual({
      type: "result",
      result: { kind: "value", value: { kind: "unit" } },
    });
  });

  it("terminates a current worker at the timeout and ignores stale workers", () => {
    vi.useFakeTimers();
    const worker = { terminate: vi.fn() };
    const onTimeout = vi.fn();
    let current = true;
    scheduleWorkerTimeout(worker, 2_000, () => current, onTimeout);
    vi.advanceTimersByTime(1_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledOnce();

    const staleWorker = { terminate: vi.fn() };
    current = false;
    scheduleWorkerTimeout(staleWorker, 2_000, () => current, onTimeout);
    vi.advanceTimersByTime(2_000);
    expect(staleWorker.terminate).not.toHaveBeenCalled();
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("bounds output sent from the Worker to the editor page", async () => {
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    const messages: { type: string; text?: string }[] = [];
    vi.stubGlobal("self", {
      addEventListener(type: string, handler: (event: MessageEvent) => void) {
        if (type === "message") messageHandler = handler;
      },
    });
    vi.stubGlobal("postMessage", (message: { type: string; text?: string }) =>
      messages.push(message),
    );

    const source = `function createModule(host) {
      return { kind: "module", module: { exports: [], invoke() {
        host.write("x".repeat(40000));
        return { kind: "value", value: { kind: "unit" } };
      } } };
    }`;
    await import(
      `data:text/javascript;base64,${Buffer.from(createSandboxWorkerSource(source)).toString("base64")}`
    );
    messageHandler?.({ data: { type: "invoke", name: "large", arguments: [] } } as MessageEvent);
    const output = messages.filter((message) => message.type === "output");
    expect(output[0]?.text).toHaveLength(32768);
    expect(output[1]?.text).toContain("출력 제한");
  });

  it("allows only a hash-pinned import map under the local-only page policy", () => {
    const html = readFileSync(new URL("index.html", playgroundDirectory), "utf8");
    const importMap = /<script type="importmap">([\s\S]*?)<\/script>/u.exec(html)?.[1];
    expect(importMap).toBeDefined();
    const digest = createHash("sha256")
      .update(importMap ?? "")
      .digest("base64");
    expect(html).toContain(`'sha256-${digest}'`);
    expect(html).toContain("connect-src 'self'");
    expect(html).toContain("worker-src blob:");
    expect(html).not.toMatch(/https?:\/\//u);
  });
});
