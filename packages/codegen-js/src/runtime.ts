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
    run,
  };
}

export type GeulRuntime = ReturnType<typeof createRuntime>;
