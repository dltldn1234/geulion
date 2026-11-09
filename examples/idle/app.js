/* global TextDecoder, TextEncoder, document, performance, window */
import { createModule } from "./generated/game.mjs";
import { createLocalStorageRepository } from "./storage.js";
import { calculateOfflineElapsed, createWholeSecondClock } from "./clock.js";

const SAVE_KEY = "geulion-idle-save";
const APPLICATION_VERSION = "1.1.0";
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

const hostModuleResult = createModule({ write: (message) => showToast(message) });
if (hostModuleResult.kind !== "module") throw new Error("GEULION 모듈을 불러오지 못했습니다.");
const game = hostModuleResult.module;
const integer = (value) => ({ kind: "integer", decimal: String(value) });
const list = (values) => ({ kind: "list", values: values.map(integer) });
const savedGame = (values, savedAt) => ({
  kind: "list",
  values: [list(values), integer(savedAt)],
});
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
  const values = value.values.map((item) => BigInt(item.decimal));
  if (
    values[0] < 0n ||
    values[1] < 1n ||
    values[2] < 0n ||
    values[3] < 10n ||
    values[4] < 0n ||
    values[5] < 0n
  ) {
    throw new Error("저장된 게임 통계 범위가 올바르지 않습니다. 원본 저장은 그대로 보존했습니다.");
  }
  return values;
};
const migrations = {
  "1.0.0": (legacyState) => {
    unwrapList(legacyState);
    return { kind: "list", values: [legacyState, integer(Date.now())] };
  },
};
const repository = createLocalStorageRepository(storage, SAVE_KEY, APPLICATION_VERSION, migrations);
const unwrapSavedGame = (value) => {
  if (
    value?.kind !== "list" ||
    value.values.length !== 2 ||
    value.values[0]?.kind !== "list" ||
    value.values[1]?.kind !== "integer"
  ) {
    throw new Error(
      "저장 데이터의 시각 정보가 올바르지 않습니다. 원본 저장은 그대로 보존했습니다.",
    );
  }
  const savedAt = BigInt(value.values[1].decimal);
  if (savedAt < 0n || savedAt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("저장된 시각의 범위가 올바르지 않습니다. 원본 저장은 그대로 보존했습니다.");
  }
  return { state: unwrapList(value.values[0]), savedAt: Number(savedAt) };
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
const gameClock = createWholeSecondClock();
let checkpointAt = 0;
let lastPersistedAt = 0;
let saveBusy = false;
let savePending = false;
let persistPromise = null;
let resumePending = false;
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
function persist() {
  if (state === null) return Promise.resolve(false);
  if (saveBusy) {
    savePending = true;
    return persistPromise;
  }
  saveBusy = true;
  persistPromise = saveQueuedChanges();
  return persistPromise;
}

async function saveQueuedChanges() {
  let result;
  do {
    savePending = false;
    const savedAt = Date.now();
    result = await repository.save(savedGame(state, savedAt));
    if (result.kind === "saved") {
      checkpointAt = savedAt;
      lastPersistedAt = performance.now();
    }
  } while (savePending && result.kind === "saved");
  saveBusy = false;
  persistPromise = null;
  if (result.kind !== "saved") {
    savePending = false;
    showSaveStatus(STORAGE_ERROR, true);
    showToast("저장에 실패했습니다. 브라우저 저장 공간을 확인해 주세요.");
    return false;
  }
  showSaveStatus("이 기기에 저장됨");
  if (resumePending) {
    resumePending = false;
    resumeFromHidden();
  }
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
  const progress = amount >= cost ? 100n : (amount * 100n) / cost;
  document.querySelector("#progress").style.width = `${progress}%`;
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
  if (document.visibilityState !== "visible") {
    lastTick = now;
    window.requestAnimationFrame(tick);
    return;
  }
  const elapsed = Math.max(0, now - lastTick);
  lastTick = now;
  const wholeMilliseconds = gameClock.consume(elapsed);
  if (wholeMilliseconds > 0) {
    state = unwrapList(invoke("경과", [list(state), integer(wholeMilliseconds)]));
    render();
  }
  if (now - lastPersistedAt >= 5000) void persist();
  window.requestAnimationFrame(tick);
}

function showOfflineResult(result, reward, message = "") {
  const badge = document.querySelector("#offline-result");
  badge.hidden = false;
  badge.classList.toggle("error", message !== "");
  if (message) {
    badge.textContent = message;
    return;
  }
  const elapsed = Math.floor(result.elapsedMilliseconds / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const duration =
    [hours && `${hours}시간`, minutes && `${minutes}분`, seconds && `${seconds}초`]
      .filter(Boolean)
      .join(" ") || "0초";
  badge.textContent = `${duration} 동안 별가루 ${reward.toLocaleString("ko-KR")}개를 모았어요.${result.capped ? " 오프라인 생산은 최대 8시간까지 반영돼요." : ""}`;
}

function resumeFromHidden() {
  if (state === null || document.visibilityState !== "visible") return;
  if (saveBusy) {
    resumePending = true;
    return;
  }
  const now = Date.now();
  const elapsed = calculateOfflineElapsed(checkpointAt, now);
  checkpointAt = now;
  lastTick = performance.now();
  if (elapsed.kind === "clock-rewound") {
    showOfflineResult(
      elapsed,
      0n,
      "기기 시계가 저장 시각보다 이전이라 오프라인 생산을 반영하지 않았어요.",
    );
  } else if (elapsed.kind === "invalid-clock") {
    showOfflineResult(elapsed, 0n, "기기 시각을 확인할 수 없어 오프라인 생산을 반영하지 않았어요.");
  } else if (elapsed.elapsedMilliseconds > 0) {
    const before = state[0];
    state = unwrapList(invoke("오프라인경과", [list(state), integer(elapsed.elapsedMilliseconds)]));
    showOfflineResult(elapsed, state[0] - before);
    render();
  }
  if (elapsed.kind !== "elapsed" || elapsed.elapsedMilliseconds > 0) void persist();
}

document.querySelector("#collect").addEventListener("click", () => applyAction("클릭"));
document.querySelector("#upgrade").addEventListener("click", () => {
  const previous = state[2];
  applyAction("업그레이드");
  if (state[2] > previous) showToast("별 제련기를 만들었어요. 이제 별가루가 자동으로 모입니다!");
});
document.querySelector("#reset").addEventListener("click", async () => {
  if (!window.confirm("모든 진행 상황을 지우고 새 게임을 시작할까요?")) return;
  const fresh = unwrapList(invoke("새게임"));
  const previous = state;
  document.querySelector("#collect").disabled = true;
  document.querySelector("#upgrade").disabled = true;
  document.querySelector("#reset").disabled = true;
  state = fresh;
  const saved = await persist();
  if (!saved) {
    state = previous;
    render();
    document.querySelector("#collect").disabled = false;
    document.querySelector("#reset").disabled = false;
    showToast("초기화한 내용을 저장하지 못했습니다. 기존 저장은 유지됩니다.");
    return;
  }
  gameClock.reset();
  render();
  showSaveStatus("새 게임 시작");
  document.querySelector("#collect").disabled = false;
  document.querySelector("#reset").disabled = false;
});

async function start() {
  const loaded = await repository.load();
  let shouldPersistCheckpoint = false;
  if (loaded.kind === "loaded") {
    const saved = unwrapSavedGame(loaded.value);
    state = saved.state;
    const now = Date.now();
    const elapsed = calculateOfflineElapsed(saved.savedAt, now);
    checkpointAt = now;
    if (elapsed.kind === "clock-rewound") {
      showOfflineResult(
        elapsed,
        0n,
        "기기 시계가 저장 시각보다 이전이라 오프라인 생산을 반영하지 않았어요.",
      );
      shouldPersistCheckpoint = true;
    } else if (elapsed.kind === "invalid-clock") {
      showOfflineResult(
        elapsed,
        0n,
        "기기 시각을 확인할 수 없어 오프라인 생산을 반영하지 않았어요.",
      );
      shouldPersistCheckpoint = true;
    } else if (elapsed.elapsedMilliseconds > 0) {
      const before = state[0];
      state = unwrapList(
        invoke("오프라인경과", [list(state), integer(elapsed.elapsedMilliseconds)]),
      );
      showOfflineResult(elapsed, state[0] - before);
      shouldPersistCheckpoint = true;
    }
    shouldPersistCheckpoint ||= loaded.migrated === true;
    if (loaded.migrated) showToast("이전 버전의 저장 데이터를 새 형식으로 옮겼어요.");
  } else if (loaded.kind === "absent") {
    const fresh = unwrapList(invoke("새게임"));
    const savedAt = Date.now();
    const saved = await repository.save(savedGame(fresh, savedAt));
    if (saved.kind !== "saved") throw new Error(STORAGE_ERROR);
    state = fresh;
    checkpointAt = savedAt;
    showSaveStatus("새 게임 시작");
  } else if (loaded.kind === "codec-error") {
    showSaveStatus("저장 데이터 오류", true);
    throw new Error("저장 데이터가 손상되었거나 다른 버전입니다. 원본을 덮어쓰지 않았습니다.");
  } else throw new Error(STORAGE_ERROR);
  lastPersistedAt = performance.now();
  render();
  window.requestAnimationFrame(tick);
  if (shouldPersistCheckpoint) await persist();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    lastTick = performance.now();
    void persist();
  } else {
    resumeFromHidden();
  }
});

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
