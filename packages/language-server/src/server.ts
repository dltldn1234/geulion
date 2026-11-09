#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkSource, type LanguageVersion } from "@geulion/compiler";
import type { Diagnostic, SourceSpan, TypeNode } from "@geulion/ast";

type JsonObject = Record<string, unknown>;
type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Document = { uri: string; version: number; text: string };
type PositionEncoding = "utf-8" | "utf-16" | "utf-32";
const LANGUAGE_VERSIONS = new Set<LanguageVersion>(["0.1", "0.2", "0.3"]);
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
const CORE_SIGNATURES = [
  {
    name: "출력",
    label: "출력(값: 임의) -> 없음",
    snippet: "출력(${1:값})",
    parameters: ["값: 임의"],
  },
  {
    name: "정수로",
    label: "정수로(값: 실수) -> 정수",
    snippet: "정수로(${1:실수값})",
    parameters: ["값: 실수"],
  },
  {
    name: "실수로",
    label: "실수로(값: 정수) -> 실수",
    snippet: "실수로(${1:정수값})",
    parameters: ["값: 정수"],
  },
];
const STRING_SIGNATURES = [
  {
    name: "문자열길이",
    label: "문자열길이(값: 문자열) -> 정수",
    snippet: "문자열길이(${1:문자열})",
    parameters: ["값: 문자열"],
  },
  {
    name: "문자열포함",
    label: "문자열포함(값: 문자열, 부분: 문자열) -> 불리언",
    snippet: "문자열포함(${1:문자열}, ${2:부분문자열})",
    parameters: ["값: 문자열", "부분: 문자열"],
  },
  {
    name: "문자열시작",
    label: "문자열시작(값: 문자열, 접두사: 문자열) -> 불리언",
    snippet: "문자열시작(${1:문자열}, ${2:접두사})",
    parameters: ["값: 문자열", "접두사: 문자열"],
  },
  {
    name: "문자열끝",
    label: "문자열끝(값: 문자열, 접미사: 문자열) -> 불리언",
    snippet: "문자열끝(${1:문자열}, ${2:접미사})",
    parameters: ["값: 문자열", "접미사: 문자열"],
  },
];
const KEYWORD_HELP: Record<string, string> = {
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
const MAX_CONTENT_LENGTH = 16 * 1024 * 1024;
const MAX_HEADER_LENGTH = 8 * 1024;
const MALFORMED_MESSAGE = Symbol("malformed LSP message");
type GeulTypeShape =
  | { kind: "error" }
  | { kind: "primitive"; name: string }
  | { kind: "collection"; name: string; element: GeulTypeShape };
const documents = new Map<string, Document>();
let languageVersion: LanguageVersion = "0.1";
let positionEncoding: PositionEncoding = "utf-16";
let clientSupportsSnippets = false;
let initialized = false;
let initializationComplete = false;
let shutdownRequested = false;
let input = Buffer.alloc(0);
let expectedBodyLength: number | undefined;
const pendingMessages: (JsonObject | typeof MALFORMED_MESSAGE)[] = [];
let dispatchScheduled = false;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeMessage(message: JsonObject): void {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function respond(id: unknown, result: unknown): void {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function respondError(id: unknown, code: number, message: string): void {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method: string, params: JsonObject): void {
  writeMessage({ jsonrpc: "2.0", method, params });
}

function logError(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
}

function readFrame(): JsonObject | typeof MALFORMED_MESSAGE | undefined {
  while (true) {
    if (expectedBodyLength === undefined) {
      const boundary = input.indexOf("\r\n\r\n");
      if (boundary < 0) {
        if (input.length > MAX_HEADER_LENGTH) throw new Error("LSP header exceeds the size limit");
        return undefined;
      }
      if (boundary > MAX_HEADER_LENGTH) throw new Error("LSP header exceeds the size limit");
      const headerBytes = input.subarray(0, boundary);
      if (headerBytes.some((byte) => (byte < 0x20 && byte !== 0x09) || byte > 0x7e))
        throw new Error("LSP header contains non-ASCII bytes");
      const header = headerBytes.toString("ascii");
      const lengths = header.split("\r\n").flatMap((line) => {
        const separator = line.indexOf(":");
        return separator >= 0 && line.slice(0, separator).trim().toLowerCase() === "content-length"
          ? [line.slice(separator + 1).trim()]
          : [];
      });
      if (lengths.length !== 1) throw new Error("LSP frame must contain one Content-Length header");
      if (!/^\d+$/u.test(lengths[0] ?? ""))
        throw new Error("LSP frame must contain a valid Content-Length header");
      expectedBodyLength = Number(lengths[0]);
      if (!Number.isSafeInteger(expectedBodyLength) || expectedBodyLength > MAX_CONTENT_LENGTH)
        throw new Error("LSP frame exceeds the size limit");
      input = input.subarray(boundary + 4);
    }
    if (input.length < expectedBodyLength) return undefined;
    const body = input.subarray(0, expectedBodyLength);
    input = input.subarray(expectedBodyLength);
    expectedBodyLength = undefined;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
      const parsed: unknown = JSON.parse(text);
      return isObject(parsed) ? parsed : MALFORMED_MESSAGE;
    } catch {
      return MALFORMED_MESSAGE;
    }
  }
}

function getObject(parent: JsonObject, key: string): JsonObject | undefined {
  const value = parent[key];
  return isObject(value) ? value : undefined;
}

function getString(parent: JsonObject | undefined, key: string): string | undefined {
  const value = parent?.[key];
  return typeof value === "string" ? value : undefined;
}

function getNumber(parent: JsonObject | undefined, key: string): number | undefined {
  const value = parent?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function documentPath(uri: string): string {
  try {
    return uri.startsWith("file:") ? fileURLToPath(uri) : new URL(uri).pathname;
  } catch {
    return uri;
  }
}

function encodedLength(text: string, encoding: PositionEncoding): number {
  if (encoding === "utf-8") return Buffer.byteLength(text, "utf8");
  if (encoding === "utf-32") return [...text].length;
  return text.length;
}

function positionAtOffset(text: string, offset: number): Position {
  const bounded = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  let index = 0;
  while (index < bounded) {
    const character = text[index];
    if (character === "\r" && text[index + 1] === "\n") {
      if (index + 2 > bounded)
        return { line, character: encodedLength(text.slice(lineStart, index), positionEncoding) };
      index += 2;
      line += 1;
      lineStart = index;
    } else if (character === "\r" || character === "\n") {
      index += 1;
      line += 1;
      lineStart = index;
    } else index += 1;
  }
  return { line, character: encodedLength(text.slice(lineStart, bounded), positionEncoding) };
}

function sourceRange(span: SourceSpan, text: string): Range {
  return {
    start: positionAtOffset(text, span.start.utf16Offset),
    end: positionAtOffset(text, span.end.utf16Offset),
  };
}

function sourceOffset(text: string, position: Position): number {
  if (position.line < 0 || position.character < 0) return -1;
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    const newline = text.slice(offset).search(/\r\n|\r|\n/u);
    if (newline < 0) return text.length;
    offset += newline;
    if (text.startsWith("\r\n", offset)) offset += 2;
    else offset += 1;
  }
  const lineEnd = text.slice(offset).search(/\r\n|\r|\n/u);
  const end = lineEnd < 0 ? text.length : offset + lineEnd;
  const lineText = text.slice(offset, end);
  if (positionEncoding === "utf-16") return offset + Math.min(position.character, lineText.length);
  let units = 0;
  let utf16Offset = 0;
  if (position.character === 0) return offset;
  for (const character of lineText) {
    const width = encodedLength(character, positionEncoding);
    if (units + width > position.character) return -1;
    units += width;
    utf16Offset += character.length;
    if (units === position.character) return offset + utf16Offset;
  }
  return units < position.character ? offset + lineText.length : -1;
}

function asPosition(value: unknown): Position | undefined {
  if (!isObject(value)) return undefined;
  const line = getNumber(value, "line");
  const character = getNumber(value, "character");
  return line === undefined || character === undefined ? undefined : { line, character };
}

function analyze(document: Document) {
  return checkSource({
    path: documentPath(document.uri),
    source: new TextEncoder().encode(document.text),
    languageVersion,
  });
}

function publishDiagnostics(document: Document): void {
  const result = analyze(document);
  const diagnostics = result.diagnostics.map((diagnostic) =>
    toLspDiagnostic(diagnostic, document.text),
  );
  notify("textDocument/publishDiagnostics", {
    uri: document.uri,
    version: document.version,
    diagnostics,
  });
}

function toLspDiagnostic(diagnostic: Diagnostic, text: string): JsonObject {
  const range = diagnostic.range
    ? sourceRange(diagnostic.range, text)
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const relatedInformation = diagnostic.related.flatMap((related) => {
    if (!related.path || !related.range) return [];
    return [
      {
        location: { uri: pathToUri(related.path), range: sourceRange(related.range, text) },
        message: related.message,
      },
    ];
  });
  return {
    range,
    severity: 1,
    code: diagnostic.code,
    source: "geulion",
    message: diagnostic.help ? `${diagnostic.message}\n${diagnostic.help}` : diagnostic.message,
    ...(relatedInformation.length > 0 ? { relatedInformation } : {}),
    data: { phase: diagnostic.phase, help: diagnostic.help },
  };
}

function pathToUri(path: string): string {
  return path.startsWith("file:") ? path : pathToFileURL(path).toString();
}

function currentAnalysis(document: Document) {
  const result = analyze(document);
  return result.success ? result : undefined;
}

function referencesAt(document: Document, offset: number) {
  const analysis = currentAnalysis(document);
  if (!analysis) return undefined;
  for (const [reference, symbolId] of analysis.program.references) {
    if (offset >= reference.span.start.utf16Offset && offset < reference.span.end.utf16Offset) {
      const symbol = analysis.program.symbols.get(symbolId);
      return symbol ? { analysis, reference, symbol, symbolId } : undefined;
    }
  }
  return undefined;
}

function availableSignatures() {
  return languageVersion === "0.1" ? CORE_SIGNATURES : [...CORE_SIGNATURES, ...STRING_SIGNATURES];
}

function activeCall(text: string, offset: number): { name: string; parameter: number } | undefined {
  const stack: { open: number; commas: number }[] = [];
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < Math.min(offset, text.length); index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "#") {
      const newline = text.indexOf("\n", index);
      index = newline < 0 ? offset : newline;
    } else if (character === "(") stack.push({ open: index, commas: 0 });
    else if (character === ")") stack.pop();
    else if (character === "," && stack.length > 0) {
      const current = stack[stack.length - 1];
      if (current) current.commas += 1;
    }
  }
  const current = stack[stack.length - 1];
  if (!current) return undefined;
  const before = text.slice(0, current.open).match(/([\p{ID_Start}_][\p{ID_Continue}_]*)\s*$/u);
  const name = before?.[1];
  return name ? { name, parameter: current.commas } : undefined;
}

function wordAt(text: string, offset: number): string | undefined {
  const expression = /[\p{ID_Start}_][\p{ID_Continue}_]*/uy;
  const startExpression = /[\p{ID_Start}_][\p{ID_Continue}_]*/uy;
  for (let start = Math.max(0, offset - 64); start <= Math.min(offset, text.length); start += 1) {
    startExpression.lastIndex = start;
    const match = startExpression.exec(text);
    if (!match || start + match[0].length < offset) continue;
    expression.lastIndex = start;
    return expression.exec(text)?.[0];
  }
  return undefined;
}

function insideComment(text: string, offset: number): boolean {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < Math.min(offset, text.length); index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "#") {
      const newline = text.indexOf("\n", index);
      if (newline < 0 || offset <= newline) return true;
      index = newline;
    }
  }
  return false;
}

function handleRequest(method: string, params: JsonObject): unknown {
  if (shutdownRequested) throw new RpcError(-32600, "Server has shut down");
  if (method === "initialize") {
    if (initialized) throw new RpcError(-32600, "Server is already initialized");
    const clientCapabilities = getObject(params, "capabilities");
    const general = getObject(clientCapabilities ?? {}, "general");
    const textDocumentCapabilities = getObject(clientCapabilities ?? {}, "textDocument");
    const completionCapabilities = getObject(textDocumentCapabilities ?? {}, "completion");
    const completionItemCapabilities = getObject(completionCapabilities ?? {}, "completionItem");
    clientSupportsSnippets = completionItemCapabilities?.snippetSupport === true;
    const offeredEncodings = general?.positionEncodings;
    const supportedEncodings: PositionEncoding[] = ["utf-8", "utf-16", "utf-32"];
    positionEncoding = Array.isArray(offeredEncodings)
      ? (offeredEncodings.find(
          (encoding): encoding is PositionEncoding =>
            typeof encoding === "string" &&
            supportedEncodings.includes(encoding as PositionEncoding),
        ) ?? "utf-16")
      : "utf-16";
    const options = getObject(params, "initializationOptions");
    const requestedVersion = getString(options ?? {}, "languageVersion");
    if (requestedVersion && LANGUAGE_VERSIONS.has(requestedVersion as LanguageVersion))
      languageVersion = requestedVersion as LanguageVersion;
    initialized = true;
    return {
      capabilities: {
        positionEncoding,
        textDocumentSync: { openClose: true, change: 1 },
        completionProvider: { resolveProvider: false },
        signatureHelpProvider: { triggerCharacters: ["(", ","], retriggerCharacters: [","] },
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
      },
      serverInfo: { name: "GEULION Language Server", version: "0.1.0" },
    };
  }
  if (!initialized && method !== "shutdown") throw new RpcError(-32002, "Server not initialized");
  if (initialized && !initializationComplete && method !== "shutdown")
    throw new RpcError(-32002, "Client initialization is not complete");
  if (method === "shutdown") {
    shutdownRequested = true;
    return null;
  }
  if (method === "textDocument/completion") {
    const document = getDocument(params);
    if (!document) return [];
    const items = KEYWORDS.map((label) => ({ label, kind: 14, detail: "GEULION 예약어" }));
    for (const signature of availableSignatures())
      items.push({
        label: signature.name,
        kind: 3,
        detail: signature.label,
        insertText: clientSupportsSnippets ? signature.snippet : `${signature.name}()`,
        ...(clientSupportsSnippets ? { insertTextFormat: 2 } : {}),
      } as (typeof items)[number]);
    const analysis = currentAnalysis(document);
    for (const fn of analysis?.program.ast.functions ?? [])
      items.push({
        label: fn.name.raw,
        kind: 3,
        detail: `${fn.parameters.map((parameter) => formatType(parameter.type)).join(", ")} -> ${formatType(fn.returnType)}`,
      } as (typeof items)[number]);
    if (languageVersion === "0.3")
      items.push({
        label: "공개 함수",
        kind: 15,
        detail: "v0.3 공개 함수 선언",
        insertText: clientSupportsSnippets
          ? "공개 함수 ${1:이름}() -> ${2:없음} {\n\t$0\n}"
          : "공개 함수 이름() -> 없음 {\n\t\n}",
        ...(clientSupportsSnippets ? { insertTextFormat: 2 } : {}),
      } as (typeof items)[number]);
    return { isIncomplete: false, items };
  }
  if (method === "textDocument/signatureHelp") {
    const document = getDocument(params);
    const position = asPosition(getObject(params, "position"));
    if (!document || !position) return null;
    const active = activeCall(document.text, sourceOffset(document.text, position));
    const signature = availableSignatures().find((candidate) => candidate.name === active?.name);
    if (!signature || !active) return null;
    return {
      signatures: [
        { label: signature.label, parameters: signature.parameters.map((label) => ({ label })) },
      ],
      activeSignature: 0,
      activeParameter: Math.min(active.parameter, signature.parameters.length - 1),
    };
  }
  if (method === "textDocument/hover") {
    const document = getDocument(params);
    const position = asPosition(getObject(params, "position"));
    if (!document || !position) return null;
    const offset = sourceOffset(document.text, position);
    if (insideComment(document.text, offset)) return null;
    const reference = referencesAt(document, offset);
    if (reference) {
      const symbol = reference.symbol;
      const contents =
        symbol.kind === "function" || symbol.kind === "prelude"
          ? `\`\`\`geulion\n${symbol.name}(${symbol.signature.parameters.map((parameter, index) => `${index + 1}: ${parameter ? typeName(parameter) : "임의"}`).join(", ")}) -> ${typeName(symbol.signature.returnType)}\n\`\`\``
          : `${symbol.kind} \`${symbol.name}\``;
      return {
        contents: { kind: "markdown", value: contents },
        range: sourceRange(reference.reference.span, document.text),
      };
    }
    const word = wordAt(document.text, offset);
    if (!word) return null;
    const signature = availableSignatures().find((candidate) => candidate.name === word);
    const help = signature?.label ?? KEYWORD_HELP[word];
    return help ? { contents: { kind: "markdown", value: help } } : null;
  }
  if (
    method === "textDocument/definition" ||
    method === "textDocument/references" ||
    method === "textDocument/prepareRename"
  ) {
    const document = getDocument(params);
    const position = asPosition(getObject(params, "position"));
    if (!document || !position) return method === "textDocument/references" ? [] : null;
    const match = referencesAt(document, sourceOffset(document.text, position));
    if (!match || !match.symbol.span) return method === "textDocument/references" ? [] : null;
    const location = { uri: document.uri, range: sourceRange(match.symbol.span, document.text) };
    if (method === "textDocument/definition") return location;
    if (method === "textDocument/prepareRename")
      return {
        range: sourceRange(match.reference.span, document.text),
        placeholder: match.reference.raw,
      };
    const context = getObject(params, "context");
    const includeDeclaration = context?.includeDeclaration === true;
    return [...match.analysis.program.references]
      .filter(
        ([reference, symbolId]) =>
          symbolId === match.symbolId &&
          (includeDeclaration || !sameSpan(reference.span, match.symbol.span)),
      )
      .map(([reference]) => ({
        uri: document.uri,
        range: sourceRange(reference.span, document.text),
      }));
  }
  if (method === "textDocument/documentSymbol") {
    const document = getDocument(params);
    const analysis = document ? currentAnalysis(document) : undefined;
    if (!document || !analysis) return [];
    return analysis.program.ast.functions.map((fn) => ({
      name: fn.name.raw,
      detail: `${fn.visibility === "public" ? "공개 " : ""}함수 ${fn.name.raw}(${fn.parameters.map((parameter) => `${parameter.name.raw}: ${formatType(parameter.type)}`).join(", ")}) -> ${formatType(fn.returnType)}`,
      kind: 12,
      range: sourceRange(fn.span, document.text),
      selectionRange: sourceRange(fn.name.span, document.text),
    }));
  }
  if (method === "textDocument/rename") return rename(params);
  throw new RpcError(-32601, `Method not found: ${method}`);
}

function getDocument(params: JsonObject): Document | undefined {
  const textDocument = getObject(params, "textDocument");
  const uri = getString(textDocument, "uri");
  return uri ? documents.get(uri) : undefined;
}

function rename(params: JsonObject): unknown {
  const document = getDocument(params);
  const position = asPosition(getObject(params, "position"));
  const newName = getString(params, "newName");
  if (!document || !position || !newName || !/^[_\p{ID_Start}][\p{ID_Continue}_]*$/u.test(newName))
    return null;
  const match = referencesAt(document, sourceOffset(document.text, position));
  if (!match?.symbol.span) return null;
  const references = [...match.analysis.program.references]
    .filter(([, symbolId]) => symbolId === match.symbolId)
    .map(([reference]) => reference);
  const edits = references.map((reference) => ({
    range: sourceRange(reference.span, document.text),
    newText: newName,
    start: reference.span.start.utf16Offset,
    end: reference.span.end.utf16Offset,
  }));
  let renamedText = document.text;
  for (const edit of [...edits].sort((left, right) => right.start - left.start))
    renamedText = renamedText.slice(0, edit.start) + newName + renamedText.slice(edit.end);
  const check = checkSource({
    path: documentPath(document.uri),
    source: new TextEncoder().encode(renamedText),
    languageVersion,
  });
  if (!check.success) return null;
  return { changes: { [document.uri]: edits.map(({ range, newText }) => ({ range, newText })) } };
}

function sameSpan(left: SourceSpan, right: SourceSpan | null): boolean {
  return (
    right !== null &&
    left.start.utf16Offset === right.start.utf16Offset &&
    left.end.utf16Offset === right.end.utf16Offset
  );
}

function typeName(type: GeulTypeShape): string {
  if (type.kind === "error") return "오류 타입";
  if (type.kind === "collection")
    return `${type.name}[${type.element ? typeName(type.element) : "?"}]`;
  return type.name ?? "알 수 없음";
}

function formatType(type: TypeNode): string {
  return type.kind === "PrimitiveType"
    ? type.name
    : `${type.collection}[${formatType(type.elementType)}]`;
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function handleNotification(method: string, params: JsonObject): void {
  if (method === "initialized") {
    if (initialized) initializationComplete = true;
    return;
  }
  if (method === "exit") {
    process.exitCode = shutdownRequested ? 0 : 1;
    process.stdin.pause();
    return;
  }
  if (!initialized || !initializationComplete || shutdownRequested) return;
  if (method === "textDocument/didOpen") {
    const textDocument = getObject(params, "textDocument");
    const uri = getString(textDocument, "uri");
    const text = getString(textDocument, "text");
    const version = getNumber(textDocument, "version");
    if (uri && text !== undefined && version !== undefined) {
      const document = { uri, text, version };
      documents.set(uri, document);
      publishDiagnostics(document);
    }
    return;
  }
  if (method === "textDocument/didChange") {
    const textDocument = getObject(params, "textDocument");
    const uri = getString(textDocument, "uri");
    const version = getNumber(textDocument, "version");
    const changes = params.contentChanges;
    const previous = uri ? documents.get(uri) : undefined;
    if (
      !uri ||
      !previous ||
      version === undefined ||
      version <= previous.version ||
      !Array.isArray(changes)
    )
      return;
    const latest = changes.at(-1);
    const text = isObject(latest) ? getString(latest, "text") : undefined;
    if (text === undefined) return;
    const document = { uri: previous.uri, version, text };
    documents.set(uri, document);
    publishDiagnostics(document);
    return;
  }
  if (method === "textDocument/didClose") {
    const textDocument = getObject(params, "textDocument");
    const uri = getString(textDocument, "uri");
    if (uri) {
      documents.delete(uri);
      notify("textDocument/publishDiagnostics", { uri, diagnostics: [] });
    }
    return;
  }
  if (method === "workspace/didChangeConfiguration") {
    const settings = getObject(params, "settings");
    const geulion = getObject(settings ?? {}, "geulion");
    const next = getString(geulion ?? {}, "languageVersion");
    if (next && LANGUAGE_VERSIONS.has(next as LanguageVersion)) {
      languageVersion = next as LanguageVersion;
      for (const document of documents.values()) publishDiagnostics(document);
    }
  }
}

function requestIdKey(id: unknown): string {
  return JSON.stringify(id);
}

function dispatch(message: JsonObject): void {
  const method = getString(message, "method");
  const hasId = Object.hasOwn(message, "id");
  if (
    message.jsonrpc !== "2.0" ||
    !method ||
    (hasId && typeof message.id !== "string" && typeof message.id !== "number") ||
    (Object.hasOwn(message, "params") &&
      !Array.isArray(message.params) &&
      !isObject(message.params)) ||
    (hasId && Object.hasOwn(message, "result")) ||
    (hasId && Object.hasOwn(message, "error"))
  ) {
    if (hasId) respondError(message.id, -32600, "Invalid Request");
    return;
  }
  const rawParams = message.params;
  const params = isObject(rawParams) ? rawParams : {};
  if (hasId) {
    const id = message.id;
    try {
      const result = handleRequest(method, params);
      respond(id, result);
    } catch (error) {
      if (error instanceof RpcError) respondError(id, error.code, error.message);
      else {
        logError(error);
        respondError(id, -32603, "Internal error");
      }
    }
  } else {
    try {
      if (method !== "$/cancelRequest") handleNotification(method, params);
    } catch (error) {
      logError(error);
    }
  }
}

function processPendingMessages(): void {
  dispatchScheduled = false;
  const batch = pendingMessages.splice(0);
  const requestIds = new Set(
    batch.flatMap((message) =>
      message !== MALFORMED_MESSAGE && Object.hasOwn(message, "id")
        ? [requestIdKey(message.id)]
        : [],
    ),
  );
  const cancelledIds = new Set<string>();
  for (const message of batch) {
    if (message === MALFORMED_MESSAGE || getString(message, "method") !== "$/cancelRequest")
      continue;
    const params = getObject(message, "params");
    const id = params?.id;
    const key = requestIdKey(id);
    if (id !== undefined && requestIds.has(key)) cancelledIds.add(key);
  }
  for (const message of batch) {
    if (message === MALFORMED_MESSAGE) {
      respondError(null, -32700, "Parse error");
      continue;
    }
    if (getString(message, "method") === "$/cancelRequest") continue;
    if (Object.hasOwn(message, "id") && cancelledIds.has(requestIdKey(message.id))) {
      cancelledIds.delete(requestIdKey(message.id));
      respondError(message.id, -32800, "Request cancelled");
      continue;
    }
    dispatch(message);
  }
}

function scheduleDispatch(): void {
  if (dispatchScheduled || pendingMessages.length === 0) return;
  dispatchScheduled = true;
  setImmediate(processPendingMessages);
}

process.stdin.on("data", (chunk: Buffer) => {
  input = Buffer.concat([input, chunk]);
  try {
    let message = readFrame();
    while (message) {
      pendingMessages.push(message);
      message = readFrame();
    }
    scheduleDispatch();
  } catch (error) {
    logError(error);
    process.exitCode = 1;
    process.stdin.pause();
  }
});
process.stdin.on("end", () => {
  if (input.length > 0 || expectedBodyLength !== undefined) {
    logError(new Error("Unexpected end of input inside an LSP frame"));
    process.exitCode = 1;
  }
});
