/* global TextDecoder, TextEncoder, atob, btoa, setTimeout */

export const MAX_SOURCE_BYTES = 262_144;
export const MAX_SHARED_BYTES = 24_576;

export function scheduleWorkerTimeout(worker, milliseconds, isCurrent, onTimeout) {
  return setTimeout(() => {
    if (!isCurrent()) return;
    worker.terminate();
    onTimeout();
  }, milliseconds);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    const chunk = bytes.subarray(start, Math.min(start + 0x8000, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function encodeSharedCode(source) {
  const bytes = new TextEncoder().encode(source);
  if (bytes.length > MAX_SHARED_BYTES) {
    throw new RangeError(
      `공유 링크는 ${MAX_SHARED_BYTES.toLocaleString("ko-KR")} bytes 이하만 지원합니다.`,
    );
  }
  return `#code=${bytesToBase64Url(bytes)}`;
}

export function decodeSharedCode(fragment) {
  if (!fragment.startsWith("#code=")) return undefined;
  const encoded = fragment.slice("#code=".length);
  if (
    !/^[A-Za-z0-9_-]*$/u.test(encoded) ||
    encoded.length > Math.ceil((MAX_SHARED_BYTES * 4) / 3)
  ) {
    throw new TypeError("공유 코드 링크 형식이 올바르지 않습니다.");
  }
  const base64 = encoded.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new TypeError("공유 코드 링크를 해독할 수 없습니다.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length > MAX_SHARED_BYTES) {
    throw new RangeError("공유 코드가 허용 크기를 초과합니다.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("공유 코드가 올바른 UTF-8이 아닙니다.");
  }
}

export function createSandboxWorkerSource(compiledModule) {
  return `${compiledModule}
let playgroundOutputCharacters = 0;
let playgroundOutputMessages = 0;
let playgroundOutputLimitReported = false;
function playgroundWrite(text) {
  if (playgroundOutputMessages >= 2048 || playgroundOutputCharacters >= 32768) {
    if (!playgroundOutputLimitReported) {
      playgroundOutputLimitReported = true;
      postMessage({ type: "output", text: "출력 제한에 도달해 나머지 결과를 생략했습니다." });
    }
    return;
  }
  const value = String(text);
  const remaining = 32768 - playgroundOutputCharacters;
  const chunk = value.slice(0, remaining);
  playgroundOutputCharacters += chunk.length;
  playgroundOutputMessages += 1;
  postMessage({ type: "output", text: chunk });
  if (chunk.length < value.length) {
    playgroundOutputLimitReported = true;
    postMessage({ type: "output", text: "출력 제한에 도달해 나머지 결과를 생략했습니다." });
  }
}
const playgroundModuleResult = createModule({
  write(text) { playgroundWrite(text); }
});
if (playgroundModuleResult.kind !== "module") {
  postMessage({ type: "initialization-error", result: playgroundModuleResult });
} else {
  const playgroundModule = playgroundModuleResult.module;
  self.addEventListener("message", (event) => {
    if (event.data?.type !== "invoke") return;
    try {
      postMessage({
        type: "result",
        result: playgroundModule.invoke(event.data.name, event.data.arguments)
      });
    } catch (error) {
      postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });
  postMessage({ type: "ready", exports: playgroundModule.exports });
}
`;
}
