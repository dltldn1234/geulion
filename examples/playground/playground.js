/* global AbortController, Blob, DOMException, Event, Option, TextEncoder, URL, Worker, clearTimeout, document, fetch, location, navigator, setTimeout, window */

import { compileSource } from "@geulion/compiler";
import {
  createSandboxWorkerSource,
  decodeSharedCode,
  encodeSharedCode,
  MAX_SOURCE_BYTES,
  scheduleWorkerTimeout,
} from "./playground-core.js";

const examples = {
  hello: { name: "첫 프로그램", path: "./examples/hello.geul" },
  math: { name: "정수 계산", path: "./examples/math.geul" },
  collections: { name: "목록과 선택", path: "./examples/collections.geul" },
};

const editor = document.querySelector("#source-editor");
const lineGutter = document.querySelector("#line-gutter");
const output = document.querySelector("#output");
const exportSelect = document.querySelector("#export-select");
const argumentFields = document.querySelector("#argument-fields");
const runButton = document.querySelector("#run-button");
const editorStatus = document.querySelector("#editor-status");
const sourceSize = document.querySelector("#source-size");
const exampleSelect = document.querySelector("#example-select");
const toast = document.querySelector("#toast");

let activeWorker;
let workerUrl;
let workerReady = false;
let activeExports = [];
let timeoutHandle;
let toastHandle;
let exampleLoadController;
let exampleLoadId = 0;
let outputChars = 0;
const sourceLimit = MAX_SOURCE_BYTES;

function appendOutput(text, kind = "") {
  if (output.querySelector(".empty-output")) output.replaceChildren();
  const safeText = String(text);
  const remaining = Math.max(0, 32_768 - outputChars);
  if (remaining === 0) return;
  const line = document.createElement("p");
  line.className = `output-line ${kind}`.trim();
  line.textContent = safeText.slice(0, remaining);
  output.append(line);
  outputChars += line.textContent.length;
  if (safeText.length > remaining)
    appendOutput("출력 제한에 도달해 나머지 결과를 생략했습니다.", "muted");
  output.scrollTop = output.scrollHeight;
}

function clearOutput() {
  outputChars = 0;
  const empty = document.createElement("p");
  empty.className = "empty-output";
  empty.textContent = "컴파일 결과와 프로그램 출력을 여기에 표시합니다.";
  output.replaceChildren(empty);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => toast.classList.remove("visible"), 2200);
}

function updateEditorChrome() {
  const lineCount = editor.value.split("\n").length;
  lineGutter.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");
  const bytes = new TextEncoder().encode(editor.value).length;
  sourceSize.textContent = `${bytes.toLocaleString("ko-KR")} B`;
  editorStatus.textContent = bytes > sourceLimit ? "소스 크기 제한 초과" : "GEULION · v0.3";
  editorStatus.classList.toggle("error", bytes > sourceLimit);
}

function stopWorker(terminate = true) {
  clearTimeout(timeoutHandle);
  timeoutHandle = undefined;
  if (terminate) activeWorker?.terminate();
  activeWorker = undefined;
  workerReady = false;
  activeExports = [];
  exportSelect.replaceChildren(new Option("먼저 컴파일하세요", ""));
  exportSelect.disabled = true;
  argumentFields.replaceChildren();
  runButton.innerHTML = "<span>▶</span> 컴파일 후 실행";
  runButton.disabled = false;
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  workerUrl = undefined;
}

function formatLocation(range) {
  if (!range?.start) return "";
  return `:${range.start.line}:${range.start.column}`;
}

function showDiagnostics(diagnostics) {
  clearOutput();
  if (diagnostics.length === 0) {
    appendOutput("검사 통과: 컴파일 진단이 없습니다.", "success");
    return;
  }
  for (const diagnostic of diagnostics) {
    appendOutput(
      `${diagnostic.code} ${diagnostic.message}${formatLocation(diagnostic.range)}${diagnostic.help ? `\n도움말: ${diagnostic.help}` : ""}`,
      "error",
    );
  }
}

function compileCurrentSource() {
  const source = editor.value;
  const sourceBytes = new TextEncoder().encode(source);
  if (sourceBytes.length > sourceLimit) {
    throw new RangeError(`소스는 ${sourceLimit.toLocaleString("ko-KR")} bytes 이하만 지원합니다.`);
  }
  return compileSource({
    path: "main.geul",
    source: sourceBytes,
    target: "browser",
    languageVersion: "0.3",
  });
}

function typeLabel(type) {
  return type.kind === "primitive" ? type.name : `${type.name}[${typeLabel(type.element)}]`;
}

function createField(parameter, index) {
  const field = document.createElement("div");
  field.className = "argument-field";
  const label = document.createElement("label");
  label.className = "argument-label";
  label.htmlFor = `argument-${index}`;
  label.textContent = `${parameter.name ?? `매개변수 ${index + 1}`} · ${typeLabel(parameter)}`;
  field.append(label);

  if (parameter.kind === "primitive" && parameter.name === "없음") {
    const hint = document.createElement("span");
    hint.className = "argument-label";
    hint.textContent = "값을 입력하지 않습니다.";
    field.append(hint);
    return field;
  }

  const input = document.createElement(parameter.kind === "collection" ? "textarea" : "input");
  input.id = `argument-${index}`;
  input.dataset.argumentIndex = String(index);
  input.dataset.type = JSON.stringify(parameter);
  if (parameter.kind === "primitive" && parameter.name === "불리언") {
    const booleanSelect = document.createElement("select");
    booleanSelect.id = input.id;
    booleanSelect.dataset.argumentIndex = String(index);
    booleanSelect.dataset.type = JSON.stringify(parameter);
    booleanSelect.add(new Option("참", "true"));
    booleanSelect.add(new Option("거짓", "false"));
    field.append(booleanSelect);
    return field;
  }
  if (parameter.kind === "primitive") {
    input.type = "text";
    input.value = parameter.name === "문자열" ? "" : "0";
    input.placeholder = parameter.name === "문자열" ? "문자열 입력" : "숫자 입력";
  } else {
    input.value = parameter.name === "목록" ? "[]" : parameter.name === "사전" ? "{}" : "null";
    input.placeholder = "JSON 값";
  }
  field.append(input);
  return field;
}

function renderArguments() {
  argumentFields.replaceChildren();
  const selected = activeExports.find((entry) => entry.name === exportSelect.value);
  if (!selected) return;
  for (const [index, parameter] of selected.parameters.entries()) {
    argumentFields.append(createField(parameter, index));
  }
  if (selected.parameters.length === 0) {
    const hint = document.createElement("span");
    hint.className = "argument-label";
    hint.textContent = "매개변수가 없는 함수입니다.";
    argumentFields.append(hint);
  }
}

function convertArgument(raw, type) {
  if (type.kind === "primitive") {
    switch (type.name) {
      case "없음":
        return { kind: "unit" };
      case "정수":
        if (!/^-?(?:0|[1-9][0-9]*)$/u.test(raw.trim()))
          throw new TypeError("정수는 10진수로 입력하세요.");
        return { kind: "integer", decimal: raw.trim() };
      case "실수":
        if (!Number.isFinite(Number(raw))) throw new TypeError("유한한 실수를 입력하세요.");
        return { kind: "real", value: raw.trim() };
      case "문자열":
        return { kind: "string", value: raw };
      case "불리언":
        return { kind: "boolean", value: raw === "true" };
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError(`${type.name} 값은 올바른 JSON이어야 합니다.`);
  }
  if (type.name === "선택") {
    return parsed === null
      ? { kind: "none" }
      : { kind: "some", value: convertArgument(JSON.stringify(parsed), type.element) };
  }
  if (type.name === "목록") {
    if (!Array.isArray(parsed)) throw new TypeError("목록 값은 JSON 배열이어야 합니다.");
    return {
      kind: "list",
      values: parsed.map((value) => convertArgument(JSON.stringify(value), type.element)),
    };
  }
  if (type.name === "사전") {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("사전 값은 JSON 객체여야 합니다.");
    }
    return {
      kind: "dictionary",
      entries: Object.entries(parsed).map(([key, value]) => [
        key,
        convertArgument(JSON.stringify(value), type.element),
      ]),
    };
  }
  throw new TypeError("지원하지 않는 매개변수 타입입니다.");
}

function readArguments(signature) {
  return signature.parameters.map((parameter, index) => {
    if (parameter.kind === "primitive" && parameter.name === "없음") return { kind: "unit" };
    const field = argumentFields.querySelector(`[data-argument-index="${index}"]`);
    if (!field) throw new Error("매개변수 입력을 찾을 수 없습니다.");
    return convertArgument(field.value, parameter);
  });
}

function displayValue(value) {
  if (!value || typeof value !== "object") return String(value);
  if (value.kind === "unit") return "없음";
  if (value.kind === "none") return "비어있음";
  if (value.kind === "integer") return value.decimal;
  if (value.kind === "real") return value.value;
  if (value.kind === "string") return JSON.stringify(value.value);
  if (value.kind === "boolean") return value.value ? "참" : "거짓";
  if (value.kind === "some") return `일부(${displayValue(value.value)})`;
  if (value.kind === "list") return `[${value.values.map(displayValue).join(", ")}]`;
  if (value.kind === "dictionary")
    return `{${value.entries.map(([key, item]) => `${JSON.stringify(key)}: ${displayValue(item)}`).join(", ")}}`;
  return JSON.stringify(value);
}

function handleWorkerMessage(worker, event) {
  if (worker !== activeWorker) return;
  const message = event.data;
  if (message.type === "ready") {
    clearTimeout(timeoutHandle);
    timeoutHandle = undefined;
    workerReady = true;
    activeExports = message.exports;
    exportSelect.replaceChildren(
      ...activeExports.map(
        (entry) => new Option(`${entry.name} · ${entry.parameters.length}개 매개변수`, entry.name),
      ),
    );
    exportSelect.disabled = activeExports.length === 0;
    renderArguments();
    runButton.innerHTML = "<span>▶</span> 선택한 함수 실행";
    runButton.disabled = false;
    appendOutput(`모듈 준비 완료 · 공개 함수 ${activeExports.length}개`, "success");
    return;
  }
  if (message.type === "output") {
    appendOutput(message.text);
    return;
  }
  if (message.type === "initialization-error") {
    appendOutput(`모듈 초기화 실패: ${JSON.stringify(message.result)}`, "error");
    stopWorker();
    return;
  }
  if (message.type === "error") {
    appendOutput(`실행 오류: ${message.message}`, "error");
    finishInvocation(worker);
    return;
  }
  if (message.type === "result") {
    const result = message.result;
    if (result.kind === "diagnostic") {
      showDiagnostics([result.diagnostic]);
    } else if (result.kind === "host-error") {
      appendOutput(`호스트 오류: ${result.error.code}`, "error");
    } else if (result.kind === "value" && result.value.kind !== "unit") {
      appendOutput(`반환값: ${displayValue(result.value)}`, "success");
    }
    finishInvocation(worker);
  }
}

function finishInvocation(worker) {
  if (worker !== activeWorker) return;
  clearTimeout(timeoutHandle);
  timeoutHandle = undefined;
  workerReady = true;
  runButton.disabled = false;
  runButton.innerHTML = "<span>▶</span> 선택한 함수 실행";
}

function invokeSelectedFunction() {
  const selected = activeExports.find((entry) => entry.name === exportSelect.value);
  if (!selected) {
    appendOutput("실행할 공개 함수를 선택하세요.", "error");
    return;
  }
  let args;
  try {
    args = readArguments(selected);
  } catch (error) {
    appendOutput(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  runButton.disabled = true;
  runButton.textContent = "실행 중…";
  timeoutHandle = scheduleWorkerTimeout(
    activeWorker,
    2000,
    () => activeWorker !== undefined,
    () => {
      stopWorker(false);
      appendOutput("실행 시간 제한을 초과했습니다. Worker를 종료했습니다.", "error");
    },
  );
  activeWorker.postMessage({ type: "invoke", name: selected.name, arguments: args });
}

function startWorker(compiledCode) {
  stopWorker();
  clearOutput();
  const workerSource = createSandboxWorkerSource(compiledCode);
  workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const worker = new Worker(workerUrl, { type: "module", name: "geulion-playground-sandbox" });
  activeWorker = worker;
  worker.onmessage = (event) => handleWorkerMessage(worker, event);
  worker.onerror = (event) => {
    if (worker !== activeWorker) return;
    event.preventDefault();
    appendOutput(`Worker 오류: ${event.message || "모듈을 시작할 수 없습니다."}`, "error");
    stopWorker();
  };
  workerReady = false;
  runButton.disabled = true;
  runButton.textContent = "모듈 준비 중…";
  timeoutHandle = scheduleWorkerTimeout(
    worker,
    2000,
    () => worker === activeWorker && !workerReady,
    () => {
      stopWorker(false);
      appendOutput("모듈 준비 시간이 초과되었습니다.", "error");
    },
  );
}

function runOrInvoke() {
  if (activeWorker && workerReady) {
    invokeSelectedFunction();
    return;
  }
  stopWorker();
  clearOutput();
  let result;
  try {
    result = compileCurrentSource();
  } catch (error) {
    appendOutput(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  if (!result.success) {
    showDiagnostics(result.diagnostics);
    return;
  }
  startWorker(result.code);
}

function checkSource() {
  stopWorker();
  let result;
  try {
    result = compileCurrentSource();
  } catch (error) {
    clearOutput();
    appendOutput(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  if (!result.success) {
    showDiagnostics(result.diagnostics);
    return;
  }
  clearOutput();
  appendOutput(
    `검사 통과 · 공개 함수 ${result.diagnostics.length === 0 ? "포함" : "확인"}`,
    "success",
  );
}

async function selectExample(key) {
  const example = examples[key];
  if (!example) return;
  exampleLoadController?.abort();
  const controller = new AbortController();
  exampleLoadController = controller;
  const loadId = ++exampleLoadId;
  stopWorker();
  editor.value = "예제를 불러오는 중…";
  document.querySelector("#file-name").textContent = `${key}.geul`;
  updateEditorChrome();
  clearOutput();
  try {
    const response = await fetch(example.path, { signal: controller.signal });
    if (!response.ok) throw new Error(`예제 파일을 불러오지 못했습니다 (${response.status}).`);
    const source = await response.text();
    if (loadId !== exampleLoadId) return;
    editor.value = source;
    updateEditorChrome();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (loadId === exampleLoadId)
      appendOutput(error instanceof Error ? error.message : String(error), "error");
  }
}

editor.addEventListener("input", () => {
  exampleLoadController?.abort();
  exampleLoadId += 1;
  stopWorker();
  updateEditorChrome();
});
editor.addEventListener("scroll", () => {
  lineGutter.scrollTop = editor.scrollTop;
});
editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("    ", start, end, "end");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
document.querySelector("#check-button").addEventListener("click", checkSource);
runButton.addEventListener("click", runOrInvoke);
exportSelect.addEventListener("change", renderArguments);
document.querySelector("#clear-output").addEventListener("click", clearOutput);
document
  .querySelector("#reset-button")
  .addEventListener("click", () => selectExample(exampleSelect.value));
exampleSelect.addEventListener("change", () => selectExample(exampleSelect.value));
document.querySelector("#share-button").addEventListener("click", async () => {
  try {
    const url = new URL(location.href);
    url.hash = encodeSharedCode(editor.value);
    await navigator.clipboard.writeText(url.toString());
    showToast("코드 공유 링크를 복사했습니다.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  }
});
window.addEventListener("pagehide", stopWorker);

try {
  const sharedCode = decodeSharedCode(location.hash);
  if (sharedCode !== undefined) {
    exampleLoadId += 1;
    editor.value = sharedCode;
    document.querySelector("#file-name").textContent = "shared.geul";
    updateEditorChrome();
  } else {
    selectExample("hello");
  }
} catch (error) {
  selectExample("hello");
  showToast(error instanceof Error ? error.message : String(error));
}
