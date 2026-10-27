import {
  BIDI_CONTROL_RANGES,
  CANONICAL_COMPOSITIONS,
  CANONICAL_DECOMPOSITIONS,
  COMBINING_CLASS_RANGES,
  DEFAULT_IGNORABLE_RANGES,
  WHITE_SPACE_RANGES,
  XID_CONTINUE_RANGES,
  XID_START_RANGES,
} from "./unicode-data.js";

export const UNICODE_VERSION = "18.0.0";

type Range = readonly [number, number];

function inRanges(codePoint: number, ranges: readonly Range[]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (range === undefined) return false;
    if (codePoint < range[0]) high = middle - 1;
    else if (codePoint > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

export function isDefaultIgnorable(codePoint: number): boolean {
  return inRanges(codePoint, DEFAULT_IGNORABLE_RANGES);
}

export function isBidiControl(codePoint: number): boolean {
  return inRanges(codePoint, BIDI_CONTROL_RANGES);
}

export function isUnicodeWhiteSpace(codePoint: number): boolean {
  return inRanges(codePoint, WHITE_SPACE_RANGES);
}

export function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

export function isIdentifierStart(codePoint: number): boolean {
  return (
    (codePoint === 0x5f || inRanges(codePoint, XID_START_RANGES)) &&
    !isDefaultIgnorable(codePoint) &&
    !isBidiControl(codePoint)
  );
}

export function isIdentifierContinue(codePoint: number): boolean {
  return (
    (codePoint === 0x5f || inRanges(codePoint, XID_CONTINUE_RANGES)) &&
    !isDefaultIgnorable(codePoint) &&
    !isBidiControl(codePoint)
  );
}

const decompositions = new Map<number, readonly number[]>(CANONICAL_DECOMPOSITIONS);
const combiningClassRanges: readonly (readonly [number, number, number])[] = COMBINING_CLASS_RANGES;
const compositions = new Map<string, number>(
  CANONICAL_COMPOSITIONS.map(([first, second, composite]) => [`${first},${second}`, composite]),
);

function combiningClass(codePoint: number): number {
  let low = 0;
  let high = combiningClassRanges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = combiningClassRanges[middle];
    if (range === undefined) return 0;
    if (codePoint < range[0]) high = middle - 1;
    else if (codePoint > range[1]) low = middle + 1;
    else return range[2];
  }
  return 0;
}

const S_BASE = 0xac00;
const L_BASE = 0x1100;
const V_BASE = 0x1161;
const T_BASE = 0x11a7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;

function decompose(codePoint: number, output: number[]): void {
  const syllableIndex = codePoint - S_BASE;
  if (syllableIndex >= 0 && syllableIndex < S_COUNT) {
    output.push(L_BASE + Math.floor(syllableIndex / N_COUNT));
    output.push(V_BASE + Math.floor((syllableIndex % N_COUNT) / T_COUNT));
    const trailingIndex = syllableIndex % T_COUNT;
    if (trailingIndex !== 0) output.push(T_BASE + trailingIndex);
    return;
  }

  const mapping = decompositions.get(codePoint);
  if (mapping === undefined) {
    output.push(codePoint);
    return;
  }
  for (const part of mapping) decompose(part, output);
}

function composePair(first: number, second: number): number | undefined {
  const lIndex = first - L_BASE;
  const vIndex = second - V_BASE;
  if (lIndex >= 0 && lIndex < L_COUNT && vIndex >= 0 && vIndex < V_COUNT) {
    return S_BASE + (lIndex * V_COUNT + vIndex) * T_COUNT;
  }

  const syllableIndex = first - S_BASE;
  const tIndex = second - T_BASE;
  if (
    syllableIndex >= 0 &&
    syllableIndex < S_COUNT &&
    syllableIndex % T_COUNT === 0 &&
    tIndex > 0 &&
    tIndex < T_COUNT
  ) {
    return first + tIndex;
  }
  return compositions.get(`${first},${second}`);
}

function fromCodePoints(codePoints: readonly number[]): string {
  const chunks: string[] = [];
  for (let start = 0; start < codePoints.length; start += 0x2000) {
    chunks.push(String.fromCodePoint(...codePoints.slice(start, start + 0x2000)));
  }
  return chunks.join("");
}

/** Unicode 18.0.0 NFC, independent of the host runtime's Unicode tables. */
export function normalizeNfc(input: string): string {
  const decomposed: number[] = [];
  for (const character of input) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined) decompose(codePoint, decomposed);
  }

  const ordered: number[] = [];
  let combiningSegment: number[] = [];
  const flushCombiningSegment = () => {
    if (combiningSegment.length > 1) {
      combiningSegment = combiningSegment
        .map((codePoint, index) => ({ codePoint, index, class: combiningClass(codePoint) }))
        .sort((left, right) => left.class - right.class || left.index - right.index)
        .map(({ codePoint }) => codePoint);
    }
    for (const codePoint of combiningSegment) ordered.push(codePoint);
    combiningSegment = [];
  };
  for (const codePoint of decomposed) {
    const currentClass = combiningClass(codePoint);
    if (currentClass === 0) {
      flushCombiningSegment();
      ordered.push(codePoint);
    } else {
      combiningSegment.push(codePoint);
    }
  }
  flushCombiningSegment();

  const composed: number[] = [];
  let starterIndex = -1;
  let starterCodePoint = 0;
  let previousClass = 0;
  for (const codePoint of ordered) {
    const currentClass = combiningClass(codePoint);
    const composite = starterIndex >= 0 ? composePair(starterCodePoint, codePoint) : undefined;
    if (composite !== undefined && (previousClass < currentClass || previousClass === 0)) {
      composed[starterIndex] = composite;
      starterCodePoint = composite;
      continue;
    }

    if (currentClass === 0) {
      starterIndex = composed.length;
      starterCodePoint = codePoint;
    }
    composed.push(codePoint);
    previousClass = currentClass;
  }

  return fromCodePoints(composed);
}

export function normalizeIdentifier(raw: string): string {
  return normalizeNfc(raw);
}
