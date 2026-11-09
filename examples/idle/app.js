/* global TextDecoder, TextEncoder, document, performance, window */
import { createModule } from "./generated/game.mjs";
import { createLocalStorageRepository } from "./storage.js";

const SAVE_KEY = "geulion-idle-save";
const APPLICATION_VERSION = "1.0.0";
const STORAGE_ERROR = "브라우저 저장소를 사용할 수 없습니다.";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const storage = {
  async read(key) {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : textEncoder.encode(raw);
  },
  async write(key, bytes) {
    window.localStorage.setItem(key, textDecoder.decode(bytes));
  },
};

const repository = createLocalStorageRepository(storage, SAVE_KEY, APPLICATION_VERSION);
const hostModuleResult = createModule({ write: (message) => showToast(message) });
if (hostModuleResult.kind !== "module") throw new Error("GEULION 모듈을 불러오지 못했습니다.");
const game = hostModuleResult.module;
const integer = (value) => ({ kind: "integer", decimal: String(value) });
const list = (values) => ({ kind: "list", values: values.map(integer) });
const unwrapList = (value) => {
  if (
    value?.kind !== "list" ||
    value.values.length !== 6 ||
    value.values.some((item) => item.kind !== "integer")
  ) {
    throw new Error(
      "저장 데이터의 게임 상태 형식이 올바르지 않습니다. 원본 저장은 그대로 보존했습니다.",
    );
  }
  return value.values.map((item) => Number(item.decimal));
};
const invoke = (name, args = []) => {
  const result = game.invoke(name, args);
  if (result.kind !== "value") {
    const diagnostic = result.diagnostic;
    throw new Error(
      diagnostic
        ? `${diagnostic.code}: ${diagnostic.message}`
        : `GEULION 호출 실패: ${result.error?.code ?? "unknown"}`,
    );
  }
  return result.value;
};
let state = null;
let lastTick = performance.now();
let tickRemainder = 0;
let lastPersistedAt = 0;
let saveBusy = false;
let toastTimer;

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}
function showSaveStatus(message, error = false) {
  const badge = document.querySelector("#save-state");
  badge.lastChild.textContent = ` ${message}`;
  badge.classList.toggle("error", error);
}
async function persist() {
  if (state === null || saveBusy) return false;
  saveBusy = true;
  const result = await repository.save(list(state));
  saveBusy = false;
  if (result.kind !== "saved") {
    showSaveStatus(STORAGE_ERROR, true);
    showToast("저장에 실패했습니다. 브라우저 저장 공간을 확인해 주세요.");
    return false;
  }
  lastPersistedAt = performance.now();
  showSaveStatus("이 기기에 저장됨");
  return true;
}
function render() {
  const [amount, clickRate, autoRate, cost, earned, seconds] = state;
  document.querySelector("#amount").textContent = amount.toLocaleString("ko-KR");
  document.querySelector("#rate").textContent = autoRate.toLocaleString("ko-KR");
  document.querySelector("#click-rate").textContent = clickRate.toLocaleString("ko-KR");
  document.querySelector("#play-time").innerHTML =
    `${seconds.toLocaleString("ko-KR")}<small> 초</small>`;
  document.querySelector("#earned").textContent = earned.toLocaleString("ko-KR");
  document.querySelector("#cost").textContent = cost.toLocaleString("ko-KR");
  document.querySelector("#remaining").textContent = Math.max(0, cost - amount).toLocaleString(
    "ko-KR",
  );
  document.querySelector("#upgrade").disabled = amount < cost;
  document.querySelector("#progress").style.width =
    `${Math.min(100, Math.floor((amount / cost) * 100))}%`;
}
function applyAction(name, args = []) {
  try {
    state = unwrapList(invoke(name, [list(state), ...args]));
    render();
    void persist();
  } catch (error) {
    showToast(error.message);
    showSaveStatus("오류", true);
  }
}
function tick(now) {
  const elapsed = Math.max(0, Math.min(10_000, now - lastTick));
  lastTick = now;
  tickRemainder += elapsed;
  const wholeMilliseconds = Math.floor(tickRemainder);
  tickRemainder -= wholeMilliseconds;
  if (wholeMilliseconds > 0) {
    state = unwrapList(invoke("경과", [list(state), integer(wholeMilliseconds)]));
    render();
  }
  if (now - lastPersistedAt >= 5000 && !saveBusy) void persist();
  window.requestAnimationFrame(tick);
}

document.querySelector("#collect").addEventListener("click", () => applyAction("클릭"));
document.querySelector("#upgrade").addEventListener("click", () => {
  const previous = state[2];
  applyAction("업그레이드");
  if (state[2] > previous) showToast("별 제련기를 만들었어요. 이제 별가루가 자동으로 모입니다!");
});
document.querySelector("#reset").addEventListener("click", async () => {
  if (!window.confirm("모든 진행 상황을 지우고 새 게임을 시작할까요?")) return;
  const fresh = invoke("새게임");
  const result = await repository.save(fresh);
  if (result.kind !== "saved") {
    showSaveStatus(STORAGE_ERROR, true);
    showToast("초기화한 내용을 저장하지 못했습니다. 기존 저장은 유지됩니다.");
    return;
  }
  state = unwrapList(fresh);
  tickRemainder = 0;
  render();
  showSaveStatus("새 게임 시작");
});

async function start() {
  const loaded = await repository.load();
  if (loaded.kind === "loaded") state = unwrapList(loaded.value);
  else if (loaded.kind === "absent") {
    const fresh = invoke("새게임");
    const saved = await repository.save(fresh);
    if (saved.kind !== "saved") throw new Error(STORAGE_ERROR);
    state = unwrapList(fresh);
    showSaveStatus("새 게임 시작");
  } else if (loaded.kind === "codec-error") {
    showSaveStatus("저장 데이터 오류", true);
    throw new Error("저장 데이터가 손상되었거나 다른 버전입니다. 원본을 덮어쓰지 않았습니다.");
  } else throw new Error(STORAGE_ERROR);
  lastPersistedAt = performance.now();
  render();
  window.requestAnimationFrame(tick);
}

start().catch((error) => {
  document.querySelector("#collect").disabled = true;
  document.querySelector("#upgrade").disabled = true;
  showSaveStatus("실행 오류", true);
  showToast(error.message);
  const banner = document.createElement("p");
  banner.className = "fatal-error";
  banner.setAttribute("role", "alert");
  banner.textContent = error.message;
  document.querySelector(".shell").prepend(banner);
});
