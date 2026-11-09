export const MAX_OFFLINE_MILLISECONDS = 8 * 60 * 60 * 1000;

export function calculateOfflineElapsed(savedAt, now) {
  if (!Number.isSafeInteger(savedAt) || savedAt < 0 || !Number.isSafeInteger(now) || now < 0) {
    return { kind: "invalid-clock", elapsedMilliseconds: 0 };
  }
  if (now < savedAt) return { kind: "clock-rewound", elapsedMilliseconds: 0 };
  const elapsedMilliseconds = now - savedAt;
  return {
    kind: "elapsed",
    elapsedMilliseconds: Math.min(elapsedMilliseconds, MAX_OFFLINE_MILLISECONDS),
    capped: elapsedMilliseconds > MAX_OFFLINE_MILLISECONDS,
  };
}

export function createWholeSecondClock() {
  let remainder = 0;
  return {
    consume(elapsedMilliseconds) {
      if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0) return 0;
      remainder += Math.min(10_000, elapsedMilliseconds);
      const wholeSeconds = Math.floor((remainder + 1e-7) / 1000);
      remainder = Math.max(0, remainder - wholeSeconds * 1000);
      return wholeSeconds * 1000;
    },
    reset() {
      remainder = 0;
    },
  };
}
