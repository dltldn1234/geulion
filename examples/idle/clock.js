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
