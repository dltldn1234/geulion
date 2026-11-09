export type GeulionValue =
  | { readonly kind: "unit" }
  | { readonly kind: "integer"; readonly decimal: string }
  | { readonly kind: "real"; readonly value: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "none" }
  | { readonly kind: "some"; readonly value: GeulionValue }
  | { readonly kind: "list"; readonly values: readonly GeulionValue[] }
  | {
      readonly kind: "dictionary";
      readonly entries: readonly (readonly [string, GeulionValue])[];
    };

export interface SaveEnvelopeV1 {
  readonly format: "geulion-save";
  readonly envelopeVersion: 1;
  readonly languageVersion: "0.3";
  readonly applicationVersion: string;
  readonly value: GeulionValue;
}

export type SaveEnvelopeErrorCode =
  | "invalid-application-version"
  | "invalid-utf8"
  | "invalid-json"
  | "invalid-envelope"
  | "unsupported-envelope-version"
  | "unsupported-language-version"
  | "invalid-value"
  | "size-limit"
  | "incompatible-application-version";

export type DecodeSaveEnvelopeResult =
  | { readonly kind: "absent" }
  | { readonly kind: "loaded"; readonly envelope: SaveEnvelopeV1 }
  | { readonly kind: "error"; readonly code: SaveEnvelopeErrorCode };

export type EncodeSaveEnvelopeResult =
  | { readonly kind: "encoded"; readonly bytes: Uint8Array }
  | { readonly kind: "error"; readonly code: SaveEnvelopeErrorCode };

export const SAVE_ENVELOPE_MAX_BYTES = 1_048_576;
export const SAVE_VALUE_MAX_DEPTH = 64;
export const SAVE_VALUE_MAX_NODES = 65_536;
export const SAVE_VALUE_MAX_COLLECTION_LENGTH = 16_384;
export const SAVE_VALUE_MAX_STRING_BYTES = 262_144;

const minimumInteger = -(1n << 63n);
const maximumInteger = (1n << 63n) - 1n;
const applicationVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const utf8Encoder = new TextEncoder();

interface Budget {
  nodes: number;
  readonly active: WeakSet<object>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataProperties(
  value: object,
  expectedKeys: readonly string[],
): Record<string, unknown> | undefined {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.length || ownKeys.some((key) => typeof key !== "string"))
    return undefined;
  const expected = new Set(expectedKeys);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys) {
    if (typeof key !== "string" || !expected.has(key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
      return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  return isPlainObject(value) ? ownDataProperties(value, keys) : undefined;
}

function exactArray(
  value: unknown,
  maximumLength = Number.MAX_SAFE_INTEGER,
): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength
  )
    return undefined;

  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string")) return undefined;
  const keySet = new Set(keys);
  if (!keySet.has("length")) return undefined;
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    if (!keySet.has(key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
      return undefined;
    result.push(descriptor.value);
  }
  return result;
}

function isScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function utf8Length(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

function compareScalarStrings(left: string, right: string): number {
  const leftScalars = [...left];
  const rightScalars = [...right];
  const limit = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < limit; index += 1) {
    const leftPoint = leftScalars[index]?.codePointAt(0);
    const rightPoint = rightScalars[index]?.codePointAt(0);
    if (leftPoint === undefined || rightPoint === undefined) return 0;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
  return leftScalars.length - rightScalars.length;
}

function validRealSpelling(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "NaN" || value === "Infinity" || value === "-Infinity" || value === "-0")
    return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed.toString() === value;
}

function normalizeValue(value: unknown, depth: number, budget: Budget): GeulionValue | undefined {
  budget.nodes += 1;
  if (budget.nodes > SAVE_VALUE_MAX_NODES || depth > SAVE_VALUE_MAX_DEPTH) return undefined;
  if (typeof value !== "object" || value === null) return undefined;
  if (budget.active.has(value)) return undefined;
  budget.active.add(value);
  try {
    const tag = exactObject(value, ["kind"]);
    if (tag !== undefined) {
      if (tag.kind === "unit") return { kind: "unit" };
      if (tag.kind === "none") return { kind: "none" };
    }

    const integerValue = exactObject(value, ["kind", "decimal"]);
    if (integerValue?.kind === "integer") {
      const decimal = integerValue.decimal;
      if (
        typeof decimal !== "string" ||
        decimal.length > 20 ||
        !/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/u.test(decimal)
      )
        return undefined;
      const integer = BigInt(decimal);
      return integer >= minimumInteger && integer <= maximumInteger
        ? { kind: "integer", decimal }
        : undefined;
    }

    const stringValue = exactObject(value, ["kind", "value"]);
    if (stringValue !== undefined) {
      if (stringValue.kind === "real") {
        return validRealSpelling(stringValue.value)
          ? { kind: "real", value: stringValue.value }
          : undefined;
      }
      if (stringValue.kind === "string") {
        const text = stringValue.value;
        return typeof text === "string" &&
          isScalarString(text) &&
          utf8Length(text) <= SAVE_VALUE_MAX_STRING_BYTES
          ? { kind: "string", value: text }
          : undefined;
      }
      if (stringValue.kind === "boolean") {
        return typeof stringValue.value === "boolean"
          ? { kind: "boolean", value: stringValue.value }
          : undefined;
      }
      if (stringValue.kind === "some") {
        const inner = normalizeValue(stringValue.value, depth + 1, budget);
        return inner === undefined ? undefined : { kind: "some", value: inner };
      }
    }

    const listValue = exactObject(value, ["kind", "values"]);
    if (listValue?.kind === "list") {
      const values = exactArray(listValue.values, SAVE_VALUE_MAX_COLLECTION_LENGTH);
      if (values === undefined) return undefined;
      const normalized: GeulionValue[] = [];
      for (const item of values) {
        const entry = normalizeValue(item, depth + 1, budget);
        if (entry === undefined) return undefined;
        normalized.push(entry);
      }
      return { kind: "list", values: normalized };
    }

    const dictionaryValue = exactObject(value, ["kind", "entries"]);
    if (dictionaryValue?.kind === "dictionary") {
      const pairs = exactArray(dictionaryValue.entries, SAVE_VALUE_MAX_COLLECTION_LENGTH);
      if (pairs === undefined) return undefined;
      const keys = new Set<string>();
      const normalized: [string, GeulionValue][] = [];
      for (const pairValue of pairs) {
        const pair = exactArray(pairValue, 2);
        if (pair === undefined || pair.length !== 2) return undefined;
        const key = pair[0];
        if (
          typeof key !== "string" ||
          !isScalarString(key) ||
          utf8Length(key) > SAVE_VALUE_MAX_STRING_BYTES ||
          keys.has(key)
        )
          return undefined;
        const entry = normalizeValue(pair[1], depth + 1, budget);
        if (entry === undefined) return undefined;
        keys.add(key);
        normalized.push([key, entry]);
      }
      normalized.sort(([left], [right]) => compareScalarStrings(left, right));
      return { kind: "dictionary", entries: normalized };
    }
    return undefined;
  } finally {
    budget.active.delete(value);
  }
}

function makeBudget(): Budget {
  return { nodes: 0, active: new WeakSet<object>() };
}

function encodedStringLength(value: string): number {
  return utf8Length(JSON.stringify(value));
}

function measureValueBytes(value: GeulionValue, maximumBytes: number): number | undefined {
  const add = (left: number, right: number): number | undefined => {
    const total = left + right;
    return total <= maximumBytes ? total : undefined;
  };
  switch (value.kind) {
    case "unit":
      return 15;
    case "none":
      return 15;
    case "integer":
      return add(28, encodedStringLength(value.decimal) + 1);
    case "real":
      return add(23, encodedStringLength(value.value) + 1);
    case "string":
      return add(25, encodedStringLength(value.value) + 1);
    case "boolean":
      return value.value ? 31 : 32;
    case "some": {
      const inner = measureValueBytes(value.value, maximumBytes);
      return inner === undefined ? undefined : add(23, inner + 1);
    }
    case "list": {
      let total = 25;
      for (let index = 0; index < value.values.length; index += 1) {
        const child = measureValueBytes(value.values[index]!, maximumBytes);
        if (child === undefined) return undefined;
        const next = add(total, child + (index === 0 ? 0 : 1));
        if (next === undefined) return undefined;
        total = next;
      }
      return add(total, 2);
    }
    case "dictionary": {
      let total = 32;
      for (let index = 0; index < value.entries.length; index += 1) {
        const [key, childValue] = value.entries[index]!;
        const child = measureValueBytes(childValue, maximumBytes);
        if (child === undefined) return undefined;
        const pair = add(encodedStringLength(key) + 3, child);
        if (pair === undefined) return undefined;
        const next = add(total, pair + (index === 0 ? 0 : 1));
        if (next === undefined) return undefined;
        total = next;
      }
      return add(total, 2);
    }
  }
}

function validApplicationVersion(value: unknown): value is string {
  return typeof value === "string" && applicationVersionPattern.test(value);
}

function byteLengthWithinLimit(bytes: Uint8Array): boolean {
  return bytes.byteLength <= SAVE_ENVELOPE_MAX_BYTES;
}

function hasDuplicateJsonObjectKey(source: string): boolean {
  let index = 0;
  let duplicate = false;

  const isJsonWhitespace = (character: string | undefined) =>
    character === "\t" || character === "\n" || character === "\r" || character === " ";

  const skipWhitespace = () => {
    while (index < source.length && isJsonWhitespace(source[index])) index += 1;
  };

  const readString = (): string | undefined => {
    if (source[index] !== '"') return undefined;
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index]!;
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index)) as string;
        } catch {
          return undefined;
        }
      }
      if (character === "\\") index += 1;
      index += 1;
    }
    return undefined;
  };

  const readValue = (): void => {
    skipWhitespace();
    if (source[index] === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (index < source.length) {
        skipWhitespace();
        const key = readString();
        if (key === undefined) return;
        if (keys.has(key)) duplicate = true;
        keys.add(key);
        skipWhitespace();
        if (source[index] !== ":") return;
        index += 1;
        readValue();
        skipWhitespace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") return;
        index += 1;
      }
      return;
    }
    if (source[index] === "[") {
      index += 1;
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      while (index < source.length) {
        readValue();
        skipWhitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") return;
        index += 1;
      }
      return;
    }
    if (source[index] === '"') {
      readString();
      return;
    }
    while (
      index < source.length &&
      !isJsonWhitespace(source[index]) &&
      source[index] !== "," &&
      source[index] !== "]" &&
      source[index] !== "}"
    )
      index += 1;
  };

  readValue();
  return duplicate;
}

export function encodeSaveEnvelope(
  applicationVersion: string,
  value: unknown,
): EncodeSaveEnvelopeResult {
  try {
    if (!validApplicationVersion(applicationVersion))
      return { kind: "error", code: "invalid-application-version" };
    const normalizedValue = normalizeValue(value, 0, makeBudget());
    if (normalizedValue === undefined) return { kind: "error", code: "invalid-value" };
    const envelopeWithPlaceholder = JSON.stringify({
      format: "geulion-save",
      envelopeVersion: 1,
      languageVersion: "0.3",
      applicationVersion,
      value: null,
    });
    const valueBudget = SAVE_ENVELOPE_MAX_BYTES - utf8Length(envelopeWithPlaceholder) + 4;
    if (measureValueBytes(normalizedValue, valueBudget) === undefined)
      return { kind: "error", code: "size-limit" };
    const envelope: SaveEnvelopeV1 = {
      format: "geulion-save",
      envelopeVersion: 1,
      languageVersion: "0.3",
      applicationVersion,
      value: normalizedValue,
    };
    const bytes = utf8Encoder.encode(JSON.stringify(envelope));
    return byteLengthWithinLimit(bytes)
      ? { kind: "encoded", bytes }
      : { kind: "error", code: "size-limit" };
  } catch {
    return { kind: "error", code: "invalid-value" };
  }
}

export function decodeSaveEnvelope(
  bytes: Uint8Array | null,
  expectedApplicationVersion: string,
): DecodeSaveEnvelopeResult {
  try {
    if (!validApplicationVersion(expectedApplicationVersion))
      return { kind: "error", code: "invalid-application-version" };
    if (bytes === null) return { kind: "absent" };
    if (!(bytes instanceof Uint8Array)) return { kind: "error", code: "invalid-envelope" };
    if (!byteLengthWithinLimit(bytes)) return { kind: "error", code: "size-limit" };

    let parsed: unknown;
    try {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (hasDuplicateJsonObjectKey(source)) return { kind: "error", code: "invalid-envelope" };
      parsed = JSON.parse(source);
    } catch (error) {
      return {
        kind: "error",
        code: error instanceof TypeError ? "invalid-utf8" : "invalid-json",
      };
    }

    const envelope = exactObject(parsed, [
      "format",
      "envelopeVersion",
      "languageVersion",
      "applicationVersion",
      "value",
    ]);
    if (envelope === undefined || envelope.format !== "geulion-save")
      return { kind: "error", code: "invalid-envelope" };
    if (typeof envelope.envelopeVersion !== "number")
      return { kind: "error", code: "invalid-envelope" };
    if (envelope.envelopeVersion !== 1)
      return { kind: "error", code: "unsupported-envelope-version" };
    if (typeof envelope.languageVersion !== "string")
      return { kind: "error", code: "invalid-envelope" };
    if (envelope.languageVersion !== "0.3")
      return { kind: "error", code: "unsupported-language-version" };
    if (!validApplicationVersion(envelope.applicationVersion))
      return { kind: "error", code: "invalid-application-version" };
    const value = normalizeValue(envelope.value, 0, makeBudget());
    if (value === undefined) return { kind: "error", code: "invalid-value" };
    if (envelope.applicationVersion !== expectedApplicationVersion)
      return { kind: "error", code: "incompatible-application-version" };

    return {
      kind: "loaded",
      envelope: {
        format: "geulion-save",
        envelopeVersion: 1,
        languageVersion: "0.3",
        applicationVersion: envelope.applicationVersion,
        value,
      },
    };
  } catch {
    return { kind: "error", code: "invalid-envelope" };
  }
}
