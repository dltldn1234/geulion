import type { Diagnostic, SourceSpan } from "@geulion/ast";

export type RuntimeValue =
  | bigint
  | number
  | string
  | boolean
  | { readonly kind: "unit" }
  | { readonly kind: "none" }
  | { readonly kind: "some"; readonly value: RuntimeValue }
  | { readonly kind: "list"; readonly values: readonly RuntimeValue[] }
  | { readonly kind: "dictionary"; readonly entries: readonly (readonly [string, RuntimeValue])[] };

export interface RuntimeHost {
  write(text: string): void;
  report(diagnostic: Diagnostic): void;
}

interface AbiType {
  readonly kind: "primitive" | "collection";
  readonly name: string;
  readonly element?: AbiType;
}

/**
 * This function is emitted into generated programs via its compiled toString().
 * Keep every runtime dependency inside its body; type-only imports are erased.
 */
export function createRuntime(host: RuntimeHost, path: string) {
  const minimumInteger = -(1n << 63n);
  const maximumInteger = (1n << 63n) - 1n;
  const unit = Object.freeze({ kind: "unit" } as const);
  const none = Object.freeze({ kind: "none" } as const);

  class RuntimeFailure extends Error {
    constructor(readonly diagnostic: Diagnostic) {
      super(diagnostic.message);
    }
  }

  function fail(
    code: "GE4001" | "GE4002" | "GE4003" | "GE4004",
    message: string,
    help: string,
    range: SourceSpan,
  ): never {
    throw new RuntimeFailure({
      code,
      phase: "runtime",
      severity: "error",
      message,
      path,
      range,
      help,
      related: [],
    });
  }

  function checked(value: bigint, span: SourceSpan): bigint {
    if (value < minimumInteger || value > maximumInteger) {
      fail(
        "GE4001",
        "정수 연산 결과가 signed 64-bit 범위를 벗어났습니다.",
        "정수 연산의 피연산자와 범위를 확인하세요.",
        span,
      );
    }
    return value;
  }

  function integerBinary(
    operator: "+" | "-" | "*" | "/" | "%",
    left: bigint,
    right: bigint,
    span: SourceSpan,
  ): bigint {
    if ((operator === "/" || operator === "%") && right === 0n) {
      fail(
        "GE4002",
        "정수를 0으로 나누거나 나머지를 구할 수 없습니다.",
        "제수가 0이 아닌지 확인하세요.",
        span,
      );
    }
    switch (operator) {
      case "+":
        return checked(left + right, span);
      case "-":
        return checked(left - right, span);
      case "*":
        return checked(left * right, span);
      case "/":
        return checked(left / right, span);
      case "%":
        return checked(left % right, span);
    }
  }

  function negateInteger(value: bigint, span: SourceSpan): bigint {
    return checked(-value, span);
  }

  function some(value: RuntimeValue) {
    return Object.freeze({ kind: "some", value } as const);
  }

  function list(values: readonly RuntimeValue[]) {
    return Object.freeze({ kind: "list", values: Object.freeze([...values]) } as const);
  }

  function dictionary(entries: readonly (readonly [string, RuntimeValue])[]) {
    return Object.freeze({
      kind: "dictionary",
      entries: Object.freeze(entries.map(([key, value]) => Object.freeze([key, value] as const))),
    } as const);
  }

  function index(target: RuntimeValue, key: RuntimeValue): RuntimeValue {
    if (typeof target !== "object") throw new Error("Invalid collection index target");
    if (target.kind === "list" && typeof key === "bigint") {
      if (key < 0n || key >= BigInt(target.values.length)) return none;
      const value = target.values[Number(key)];
      if (value === undefined) throw new Error("Missing list element");
      return some(value);
    }
    if (target.kind === "dictionary" && typeof key === "string") {
      const entry = target.entries.find(([candidate]) => candidate === key);
      return entry === undefined ? none : some(entry[1]);
    }
    throw new Error("Invalid collection index type");
  }

  function equal(left: RuntimeValue, right: RuntimeValue): boolean {
    if (typeof left !== typeof right) return false;
    if (typeof left !== "object" || typeof right !== "object") return left === right;
    if (left.kind !== right.kind) return false;
    switch (left.kind) {
      case "unit":
        return right.kind === "unit";
      case "none":
        return right.kind === "none";
      case "some":
        return right.kind === "some" && equal(left.value, right.value);
      case "list":
        return (
          right.kind === "list" &&
          left.values.length === right.values.length &&
          left.values.every((value, position) => {
            const other = right.values[position];
            return other !== undefined && equal(value, other);
          })
        );
      case "dictionary":
        return (
          right.kind === "dictionary" &&
          left.entries.length === right.entries.length &&
          left.entries.every(([key, value]) => {
            const other = right.entries.find(([candidate]) => candidate === key);
            return other !== undefined && equal(value, other[1]);
          })
        );
    }
  }

  function coalesce(option: RuntimeValue, fallback: () => RuntimeValue): RuntimeValue {
    if (typeof option !== "object") throw new Error("Invalid optional value");
    if (option.kind === "some") return option.value;
    if (option.kind === "none") return fallback();
    throw new Error("Invalid optional variant");
  }

  function compareKeys(left: string, right: string): number {
    const leftPoints = [...left];
    const rightPoints = [...right];
    const length = Math.min(leftPoints.length, rightPoints.length);
    for (let index = 0; index < length; index += 1) {
      const a = leftPoints[index]?.codePointAt(0);
      const b = rightPoints[index]?.codePointAt(0);
      if (a === undefined || b === undefined) throw new Error("Invalid dictionary key");
      if (a !== b) return a < b ? -1 : 1;
    }
    return leftPoints.length - rightPoints.length;
  }

  function canonical(value: RuntimeValue): string {
    switch (typeof value) {
      case "string":
        return value;
      case "bigint":
        return value.toString();
      case "boolean":
        return value ? "참" : "거짓";
      case "number": {
        if (Object.is(value, -0)) return "-0.0";
        if (!Number.isFinite(value)) return value.toString();
        const text = value.toString();
        return text.includes(".") || text.includes("e") ? text : `${text}.0`;
      }
      case "object": {
        switch (value.kind) {
          case "unit":
            return "없음";
          case "none":
            return "비어있음";
          case "some":
            return `일부(${canonical(value.value)})`;
          case "list":
            return `[${value.values.map(canonical).join(", ")}]`;
          case "dictionary": {
            const entries = [...value.entries].sort(([a], [b]) => compareKeys(a, b));
            return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}: ${canonical(entry)}`).join(", ")}}`;
          }
        }
      }
    }
    throw new Error("Invalid runtime value");
  }

  function output(value: RuntimeValue, span: SourceSpan) {
    const text = `${canonical(value)}\n`;
    try {
      host.write(text);
    } catch {
      fail(
        "GE4004",
        "표준 출력에 기록할 수 없습니다.",
        "출력 대상과 실행 환경의 쓰기 권한을 확인하세요.",
        span,
      );
    }
    return unit;
  }

  function toInteger(value: number, span: SourceSpan): bigint {
    if (!Number.isFinite(value) || value < -(2 ** 63) || value >= 2 ** 63) {
      fail(
        "GE4003",
        "실수를 signed 64-bit 정수로 변환할 수 없습니다.",
        "유한하며 정수 범위 안에 있는 실수를 전달하세요.",
        span,
      );
    }
    return BigInt(Math.trunc(value));
  }

  function toReal(value: bigint): number {
    return Number(value);
  }

  function stringLength(value: string): bigint {
    return BigInt([...value].length);
  }

  function stringContains(value: string, needle: string): boolean {
    const valueScalars = [...value];
    const needleScalars = [...needle];
    if (needleScalars.length === 0) return true;
    return valueScalars.some((_, start) =>
      needleScalars.every((scalar, offset) => valueScalars[start + offset] === scalar),
    );
  }

  function stringStarts(value: string, prefix: string): boolean {
    const valueScalars = [...value];
    const prefixScalars = [...prefix];
    return prefixScalars.every((scalar, index) => valueScalars[index] === scalar);
  }

  function stringEnds(value: string, suffix: string): boolean {
    const valueScalars = [...value];
    const suffixScalars = [...suffix];
    const start = valueScalars.length - suffixScalars.length;
    return (
      start >= 0 && suffixScalars.every((scalar, index) => valueScalars[start + index] === scalar)
    );
  }

  function run(entry: () => unknown): 0 | 1 | 2 {
    try {
      entry();
      return 0;
    } catch (error) {
      const diagnostic: Diagnostic =
        error instanceof RuntimeFailure
          ? error.diagnostic
          : {
              code: "GE9001",
              phase: "internal",
              severity: "error",
              message: "프로그램 실행 중 내부 컴파일러 오류가 발생했습니다.",
              path: null,
              range: null,
              help: null,
              related: [],
            };
      try {
        host.report(diagnostic);
      } catch {
        return 2;
      }
      return error instanceof RuntimeFailure ? 1 : 2;
    }
  }

  function plainObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const actual = Reflect.ownKeys(value);
    if (!(actual.every((key) => typeof key === "string") && actual.length === keys.length))
      return false;
    if (![...actual].sort().every((key, index) => key === [...keys].sort()[index])) return false;
    return actual.every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
    });
  }

  function plainArray(value: unknown, maximumLength = Number.MAX_SAFE_INTEGER): value is unknown[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength
    )
      return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") || keys.length !== lengthDescriptor.value + 1)
      return false;
    const keySet = new Set(keys);
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      if (!keySet.has(String(index))) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
        return false;
    }
    return keySet.has("length");
  }

  function scalarString(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
        index += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    }
    return true;
  }

  function byteLength(value: string): number {
    return new TextEncoder().encode(value).length;
  }

  function transportText(value: unknown): string | null {
    try {
      const encoded = JSON.stringify(value);
      if (encoded === undefined || byteLength(encoded) > 1_048_576) return null;
      return encoded;
    } catch {
      return null;
    }
  }

  function decodeAbiValue(
    value: unknown,
    type: AbiType,
    depth: number,
    budget: { nodes: number },
  ): RuntimeValue | undefined {
    budget.nodes += 1;
    if (budget.nodes > 65_536 || depth > 64 || typeof value !== "object" || value === null)
      return undefined;
    if (type.kind === "primitive") {
      switch (type.name) {
        case "없음":
          return plainObject(value, ["kind"]) && value.kind === "unit" ? unit : undefined;
        case "정수": {
          if (!plainObject(value, ["kind", "decimal"]) || value.kind !== "integer")
            return undefined;
          const decimal = value.decimal;
          if (typeof decimal !== "string" || !/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/u.test(decimal))
            return undefined;
          try {
            const integer = BigInt(decimal);
            return integer >= minimumInteger && integer <= maximumInteger ? integer : undefined;
          } catch {
            return undefined;
          }
        }
        case "실수": {
          if (!plainObject(value, ["kind", "value"]) || value.kind !== "real") return undefined;
          const text = value.value;
          if (typeof text !== "string") return undefined;
          if (text === "NaN") return Number.NaN;
          if (text === "Infinity") return Number.POSITIVE_INFINITY;
          if (text === "-Infinity") return Number.NEGATIVE_INFINITY;
          if (text === "-0") return -0;
          const number = Number(text);
          return Number.isFinite(number) && number.toString() === text ? number : undefined;
        }
        case "문자열": {
          if (!plainObject(value, ["kind", "value"]) || value.kind !== "string") return undefined;
          const text = value.value;
          return typeof text === "string" && scalarString(text) && byteLength(text) <= 262_144
            ? text
            : undefined;
        }
        case "불리언":
          return plainObject(value, ["kind", "value"]) &&
            value.kind === "boolean" &&
            typeof value.value === "boolean"
            ? value.value
            : undefined;
      }
    }
    const element = type.element;
    if (!element) return undefined;
    if (type.name === "선택") {
      if (plainObject(value, ["kind"]) && value.kind === "none") return none;
      if (!plainObject(value, ["kind", "value"]) || value.kind !== "some") return undefined;
      const inner = decodeAbiValue(value.value, element, depth + 1, budget);
      return inner === undefined ? undefined : some(inner);
    }
    if (type.name === "목록") {
      if (
        !plainObject(value, ["kind", "values"]) ||
        value.kind !== "list" ||
        !plainArray(value.values, 16_384)
      )
        return undefined;
      const values: RuntimeValue[] = [];
      for (const item of value.values) {
        const decoded = decodeAbiValue(item, element, depth + 1, budget);
        if (decoded === undefined) return undefined;
        values.push(decoded);
      }
      return list(values);
    }
    if (type.name === "사전") {
      if (
        !plainObject(value, ["kind", "entries"]) ||
        value.kind !== "dictionary" ||
        !plainArray(value.entries, 16_384)
      )
        return undefined;
      const keys = new Set<string>();
      const entries: [string, RuntimeValue][] = [];
      for (const pair of value.entries) {
        if (!plainArray(pair, 2) || pair.length !== 2) return undefined;
        const key = pair[0];
        if (
          typeof key !== "string" ||
          !scalarString(key) ||
          byteLength(key) > 262_144 ||
          keys.has(key)
        )
          return undefined;
        const decoded = decodeAbiValue(pair[1], element, depth + 1, budget);
        if (decoded === undefined) return undefined;
        keys.add(key);
        entries.push([key, decoded]);
      }
      return dictionary(entries);
    }
    return undefined;
  }

  function encodeAbiValue(
    value: RuntimeValue,
    type: AbiType,
    depth: number,
    budget: { nodes: number },
  ): unknown {
    budget.nodes += 1;
    if (budget.nodes > 65_536 || depth > 64) throw new Error("ABI value limit exceeded");
    if (type.kind === "primitive") {
      switch (type.name) {
        case "없음":
          if (typeof value === "object" && value.kind === "unit") return { kind: "unit" };
          break;
        case "정수":
          if (typeof value === "bigint" && value >= minimumInteger && value <= maximumInteger)
            return { kind: "integer", decimal: value.toString() };
          break;
        case "실수":
          if (typeof value === "number") {
            const text = Object.is(value, -0) ? "-0" : value.toString();
            return { kind: "real", value: text };
          }
          break;
        case "문자열":
          if (typeof value === "string" && scalarString(value) && byteLength(value) <= 262_144)
            return { kind: "string", value };
          break;
        case "불리언":
          if (typeof value === "boolean") return { kind: "boolean", value };
          break;
      }
      throw new Error("Runtime value does not match ABI signature");
    }
    const element = type.element;
    if (!element || typeof value !== "object")
      throw new Error("Runtime value does not match ABI signature");
    if (type.name === "선택") {
      if (value.kind === "none") return { kind: "none" };
      if (value.kind === "some")
        return { kind: "some", value: encodeAbiValue(value.value, element, depth + 1, budget) };
    }
    if (type.name === "목록" && value.kind === "list") {
      if (value.values.length > 16_384) throw new Error("ABI collection limit exceeded");
      return {
        kind: "list",
        values: value.values.map((item) => encodeAbiValue(item, element, depth + 1, budget)),
      };
    }
    if (type.name === "사전" && value.kind === "dictionary") {
      if (value.entries.length > 16_384) throw new Error("ABI collection limit exceeded");
      const keys = new Set<string>();
      return {
        kind: "dictionary",
        entries: value.entries.map(([key, item]) => {
          if (!scalarString(key) || byteLength(key) > 262_144 || keys.has(key))
            throw new Error("Invalid ABI key");
          keys.add(key);
          return [key, encodeAbiValue(item, element, depth + 1, budget)];
        }),
      };
    }
    throw new Error("Runtime value does not match ABI signature");
  }

  function invokeAbi(
    entry: (...values: RuntimeValue[]) => RuntimeValue,
    name: string,
    arguments_: unknown,
    signature: { readonly parameters: readonly AbiType[]; readonly returns: AbiType },
  ):
    | { readonly kind: "value"; readonly value: unknown }
    | { readonly kind: "diagnostic"; readonly diagnostic: Diagnostic }
    | {
        readonly kind: "host-error";
        readonly error:
          | { readonly code: "argument-mismatch"; readonly name: string }
          | { readonly code: "internal-error" };
      } {
    let values: RuntimeValue[];
    try {
      if (!plainArray(arguments_, signature.parameters.length))
        return { kind: "host-error", error: { code: "argument-mismatch", name } };
      if (arguments_.length !== signature.parameters.length)
        return { kind: "host-error", error: { code: "argument-mismatch", name } };
      const budget = { nodes: 0 };
      values = [];
      const normalizedArguments: unknown[] = [];
      for (let index = 0; index < signature.parameters.length; index += 1) {
        const type = signature.parameters[index];
        if (!type) return { kind: "host-error", error: { code: "internal-error" } };
        const decoded = decodeAbiValue(arguments_[index], type, 0, budget);
        if (decoded === undefined)
          return { kind: "host-error", error: { code: "argument-mismatch", name } };
        values.push(decoded);
        normalizedArguments.push(encodeAbiValue(decoded, type, 0, { nodes: 0 }));
      }
      if (transportText(normalizedArguments) === null)
        return { kind: "host-error", error: { code: "argument-mismatch", name } };
    } catch {
      return { kind: "host-error", error: { code: "argument-mismatch", name } };
    }
    try {
      const result = entry(...values);
      const encoded = encodeAbiValue(result, signature.returns, 0, { nodes: 0 });
      if (transportText(encoded) === null)
        return { kind: "host-error", error: { code: "internal-error" } };
      return { kind: "value", value: encoded };
    } catch (error) {
      if (error instanceof RuntimeFailure)
        return { kind: "diagnostic", diagnostic: error.diagnostic };
      return { kind: "host-error", error: { code: "internal-error" } };
    }
  }

  return {
    unit,
    none,
    some,
    list,
    dictionary,
    index,
    equal,
    coalesce,
    integerBinary,
    negateInteger,
    output,
    toInteger,
    toReal,
    stringLength,
    stringContains,
    stringStarts,
    stringEnds,
    run,
    invokeAbi,
  };
}

export type GeulRuntime = ReturnType<typeof createRuntime>;
