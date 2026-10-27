import {
  createDiagnostic,
  type Diagnostic,
  type ExpressionNode,
  type ProgramNode,
  type SourceSpan,
  type StatementNode,
  type UnaryExpressionNode,
  type BlockStatementNode,
} from "@geulion/ast";
import {
  resolveProgram,
  type ResolvedProgram,
  type ResolutionResult,
  type SymbolId,
  type FunctionSymbol,
} from "./resolver.js";
import {
  BOOLEAN,
  ERROR,
  INTEGER,
  REAL,
  STRING,
  UNIT,
  collection,
  sameType,
  typeFromNode,
  typeName,
  type GeulType,
} from "./types.js";
import { limitDiagnostics } from "./diagnostics.js";

export interface TypedProgram extends Omit<ResolvedProgram, "entrypoint"> {
  readonly checked: true;
  readonly entrypoint: FunctionSymbol;
  readonly expressionTypes: ReadonlyMap<ExpressionNode, GeulType>;
  readonly symbolTypes: ReadonlyMap<SymbolId, GeulType>;
  readonly signedMinimumLiterals: ReadonlySet<UnaryExpressionNode>;
}

export type AnalysisResult =
  | {
      readonly success: true;
      readonly program: TypedProgram;
      readonly diagnostics: readonly [];
      readonly suppressedCount: 0;
    }
  | {
      readonly success: false;
      readonly diagnostics: readonly Diagnostic[];
      readonly suppressedCount: number;
    };

const MAX_INTEGER = (1n << 63n) - 1n;
const MIN_MAGNITUDE = 1n << 63n;

export function analyzeProgram(ast: ProgramNode, path = "<stdin>"): AnalysisResult {
  return checkResolvedProgram(resolveProgram(ast, path));
}

export function checkResolvedProgram(resolution: ResolutionResult): AnalysisResult {
  const { program } = resolution;
  const diagnostics: Diagnostic[] = [...resolution.diagnostics];
  const expressionTypes = new Map<ExpressionNode, GeulType>();
  const symbolTypes = new Map<SymbolId, GeulType>();
  const signedMinimumLiterals = new Set<UnaryExpressionNode>();
  for (const symbol of program.symbols.values()) {
    if (symbol.kind === "parameter" && symbol.annotation)
      symbolTypes.set(symbol.id, symbol.annotation);
  }

  function report(
    code: "GE3001" | "GE3002" | "GE3003" | "GE3004" | "GE3005" | "GE3006" | "GE3007" | "GE3008",
    message: string,
    range: SourceSpan,
    related: Diagnostic["related"] = [],
  ) {
    diagnostics.push(
      createDiagnostic({
        code,
        phase: "type",
        message,
        path: program.path,
        range,
        related,
        help:
          code === "GE3006"
            ? "빈 값의 타입을 결정할 수 있는 타입 주석이나 인자/반환 문맥을 제공하세요."
            : "v0.1 타입 규칙에 맞게 선언과 표현식을 확인하세요.",
      }),
    );
  }
  function primitive(type: GeulType, name: string) {
    return type.kind === "primitive" && type.name === name;
  }
  function numeric(type: GeulType) {
    return primitive(type, "정수") || primitive(type, "실수");
  }
  function resolved(name: Parameters<ResolvedProgram["references"]["get"]>[0]) {
    const id = program.references.get(name);
    return id === undefined ? undefined : program.symbols.get(id);
  }

  // Synthesize only complete types, without committing missing-context errors.
  // Homogeneous siblings can supply a collection's element context in either order.
  function probe(node: ExpressionNode): GeulType | null {
    switch (node.kind) {
      case "IntegerLiteralExpression":
        return INTEGER;
      case "RealLiteralExpression":
        return REAL;
      case "StringLiteralExpression":
        return STRING;
      case "BooleanLiteralExpression":
        return BOOLEAN;
      case "UnitLiteralExpression":
        return UNIT;
      case "EmptyOptionExpression":
        return null;
      case "IdentifierExpression": {
        const s = resolved(node.name);
        return s ? (symbolTypes.get(s.id) ?? ERROR) : ERROR;
      }
      case "CallExpression": {
        const s = resolved(node.callee);
        return s && (s.kind === "function" || s.kind === "prelude")
          ? s.signature.returnType
          : ERROR;
      }
      case "GroupingExpression":
        return probe(node.expression);
      case "UnaryExpression":
        return node.operator === "아니다" ? BOOLEAN : probe(node.operand);
      case "SomeExpression": {
        const t = probe(node.value);
        return t ? collection("선택", t) : null;
      }
      case "ListExpression":
        return probeCollection(node.elements, "목록");
      case "DictionaryExpression":
        return probeCollection(
          node.entries.map((e) => e.value),
          "사전",
        );
      case "IndexExpression": {
        const t = probe(node.target);
        return t?.kind === "collection" && t.name !== "선택"
          ? collection("선택", t.element)
          : ERROR;
      }
      case "BinaryExpression": {
        if (["==", "!=", "<", "<=", ">", ">=", "그리고", "또는"].includes(node.operator))
          return BOOLEAN;
        const left = probe(node.left);
        return node.operator === "??"
          ? left?.kind === "collection" && left.name === "선택"
            ? left.element
            : ERROR
          : left;
      }
    }
  }
  function probeCollection(
    values: readonly ExpressionNode[],
    name: "목록" | "사전",
  ): GeulType | null {
    const types = values.map(probe);
    const complete = types.find((t) => t !== null && t.kind !== "error");
    if (complete) return collection(name, complete);
    return types.some((t) => t?.kind === "error") ? ERROR : null;
  }

  function requireType(actual: GeulType, expected: GeulType, span: SourceSpan): GeulType {
    if (actual.kind === "error" || expected.kind === "error") return ERROR;
    if (!sameType(actual, expected)) {
      report(
        "GE3001",
        `타입 '${typeName(expected)}'이 필요하지만 '${typeName(actual)}'입니다.`,
        span,
      );
      return ERROR;
    }
    return actual;
  }
  function checkCollection(
    node: ExpressionNode,
    values: readonly ExpressionNode[],
    name: "목록" | "사전",
    expected?: GeulType,
  ): GeulType {
    const contextual =
      expected?.kind === "collection" && expected.name === name ? expected.element : null;
    const inferred = probeCollection(values, name);
    const element =
      contextual ??
      (inferred?.kind === "collection"
        ? inferred.element
        : inferred?.kind === "error"
          ? ERROR
          : null);
    if (!element) {
      if (expected?.kind !== "error")
        report("GE3006", "컬렉션 원소의 타입을 결정할 문맥이 부족합니다.", node.span);
      values.forEach((value) => check(value, ERROR));
      return ERROR;
    }
    const types = values.map((value) => check(value, element));
    return types.some((t) => t.kind === "error") ? ERROR : collection(name, element);
  }

  function check(node: ExpressionNode, expected?: GeulType, allowMinMagnitude = false): GeulType {
    let type: GeulType;
    switch (node.kind) {
      case "IntegerLiteralExpression": {
        const magnitude = BigInt(node.raw);
        if (magnitude > MAX_INTEGER && !(allowMinMagnitude && magnitude === MIN_MAGNITUDE)) {
          report("GE3007", "정수 리터럴이 signed 64-bit 범위를 벗어납니다.", node.span);
          type = ERROR;
        } else type = INTEGER;
        break;
      }
      case "RealLiteralExpression":
        if (!Number.isFinite(Number(node.raw))) {
          report("GE3007", "실수 리터럴이 binary64 유한 범위를 벗어납니다.", node.span);
          type = ERROR;
        } else type = REAL;
        break;
      case "StringLiteralExpression":
        type = STRING;
        break;
      case "BooleanLiteralExpression":
        type = BOOLEAN;
        break;
      case "UnitLiteralExpression":
        type = UNIT;
        break;
      case "EmptyOptionExpression":
        if (expected?.kind === "collection" && expected.name === "선택") type = expected;
        else {
          if (expected?.kind !== "error")
            report("GE3006", "비어있는 선택값의 타입을 결정할 문맥이 부족합니다.", node.span);
          type = ERROR;
        }
        break;
      case "IdentifierExpression": {
        const symbol = resolved(node.name);
        if (symbol?.kind === "function" || symbol?.kind === "prelude") {
          report("GE3002", "함수 이름은 값으로 사용할 수 없습니다.", node.span);
          type = ERROR;
        } else type = symbol ? (symbolTypes.get(symbol.id) ?? ERROR) : ERROR;
        break;
      }
      case "GroupingExpression":
        type = check(node.expression, expected, allowMinMagnitude);
        break;
      case "SomeExpression": {
        const context =
          expected?.kind === "collection" && expected.name === "선택"
            ? expected.element
            : expected?.kind === "error"
              ? ERROR
              : undefined;
        type = collection("선택", check(node.value, context));
        break;
      }
      case "ListExpression":
        type = checkCollection(node, node.elements, "목록", expected);
        break;
      case "DictionaryExpression": {
        const keys = new Map<string, SourceSpan>();
        let duplicate = false;
        for (const entry of node.entries) {
          expressionTypes.set(entry.key, STRING);
          const previous = keys.get(entry.key.value);
          if (previous) {
            report("GE3008", `사전 키 '${entry.key.value}'이 중복되었습니다.`, entry.key.span, [
              { message: "이전에 작성한 키입니다.", path: program.path, range: previous },
            ]);
            duplicate = true;
          } else keys.set(entry.key.value, entry.key.span);
        }
        type = checkCollection(
          node,
          node.entries.map((e) => e.value),
          "사전",
          expected,
        );
        if (duplicate) type = ERROR;
        break;
      }
      case "CallExpression": {
        const symbol = resolved(node.callee);
        if (!symbol || (symbol.kind !== "function" && symbol.kind !== "prelude")) {
          node.arguments.forEach((a) => check(a));
          type = ERROR;
          break;
        }
        const { signature } = symbol;
        let invalid = signature.parameters.length !== node.arguments.length;
        if (invalid)
          report(
            "GE3001",
            `함수 '${symbol.name}'의 인자는 ${signature.parameters.length}개여야 합니다.`,
            node.span,
          );
        node.arguments.forEach((argument, i) => {
          if (check(argument, signature.parameters[i] ?? undefined).kind === "error")
            invalid = true;
        });
        type = invalid ? ERROR : signature.returnType;
        break;
      }
      case "IndexExpression": {
        const target = check(node.target);
        const index = check(node.index);
        if (target.kind === "error" || index.kind === "error") type = ERROR;
        else if (
          target.kind === "collection" &&
          ((target.name === "목록" && primitive(index, "정수")) ||
            (target.name === "사전" && primitive(index, "문자열")))
        )
          type = collection("선택", target.element);
        else {
          report("GE3002", "목록에는 정수, 사전에는 문자열 인덱스가 필요합니다.", node.span);
          type = ERROR;
        }
        break;
      }
      case "UnaryExpression": {
        let ungrouped = node.operand;
        while (ungrouped.kind === "GroupingExpression") ungrouped = ungrouped.expression;
        const minimum =
          node.operator === "-" &&
          ungrouped.kind === "IntegerLiteralExpression" &&
          BigInt(ungrouped.raw) === MIN_MAGNITUDE;
        const operand = check(node.operand, undefined, minimum);
        if (operand.kind === "error") type = ERROR;
        else if (node.operator === "아니다" ? primitive(operand, "불리언") : numeric(operand)) {
          type = operand;
          if (minimum) signedMinimumLiterals.add(node);
        } else {
          report("GE3002", "단항 연산자에 허용되지 않는 타입입니다.", node.span);
          type = ERROR;
        }
        break;
      }
      case "BinaryExpression": {
        const left = check(node.left);
        const right = check(node.right);
        if (left.kind === "error" || right.kind === "error") {
          type = ERROR;
          break;
        }
        if (node.operator === "??") {
          if (left.kind === "collection" && left.name === "선택" && sameType(left.element, right))
            type = right;
          else {
            report("GE3002", "선택 합치기는 `선택[T] ?? T` 타입이 필요합니다.", node.span);
            type = ERROR;
          }
          break;
        }
        const same = sameType(left, right);
        const numericPair = same && numeric(left);
        const logical = node.operator === "그리고" || node.operator === "또는";
        const equality = node.operator === "==" || node.operator === "!=";
        const comparison = ["<", "<=", ">", ">="].includes(node.operator);
        const valid = logical
          ? same && primitive(left, "불리언")
          : equality
            ? same
            : comparison
              ? numericPair
              : node.operator === "%"
                ? same && primitive(left, "정수")
                : node.operator === "+"
                  ? numericPair || (same && primitive(left, "문자열"))
                  : numericPair;
        if (!valid) {
          report(
            "GE3002",
            `연산자 '${node.operator}'에 허용되지 않는 피연산자 타입입니다.`,
            node.span,
          );
          type = ERROR;
        } else type = logical || equality || comparison ? BOOLEAN : left;
        break;
      }
    }
    if (expected && type.kind !== "error") type = requireType(type, expected, node.span);
    expressionTypes.set(node, type);
    return type;
  }

  function block(node: BlockStatementNode, returnType: GeulType, loopDepth: number): boolean {
    let fallsThrough = true;
    for (const child of node.statements) {
      const childFallsThrough = statement(child, returnType, loopDepth);
      fallsThrough = fallsThrough && childFallsThrough;
    }
    return fallsThrough;
  }
  function condition(node: ExpressionNode) {
    const type = check(node);
    if (type.kind !== "error" && !primitive(type, "불리언"))
      report("GE3002", "조건식은 불리언 타입이어야 합니다.", node.span);
  }
  function statement(node: StatementNode, returnType: GeulType, loopDepth: number): boolean {
    switch (node.kind) {
      case "VariableDeclaration": {
        const type = check(
          node.initializer,
          node.annotation ? typeFromNode(node.annotation) : undefined,
        );
        const symbol = resolved(node.name);
        if (symbol) symbolTypes.set(symbol.id, type);
        return true;
      }
      case "Assignment": {
        const symbol = resolved(node.target);
        check(node.value, symbol ? symbolTypes.get(symbol.id) : undefined);
        if (symbol?.kind === "function" || symbol?.kind === "prelude")
          report("GE3002", "함수 이름에 값을 대입할 수 없습니다.", node.target.span);
        else if (symbol && "mutable" in symbol && !symbol.mutable)
          report("GE3003", "변수로 선언한 binding만 재대입할 수 있습니다.", node.target.span);
        // An invalid assignment does not change the declared binding type.
        return true;
      }
      case "ExpressionStatement":
        check(node.expression);
        return true;
      case "ReturnStatement":
        if (node.value) check(node.value, returnType);
        else if (!primitive(returnType, "없음"))
          report("GE3001", "이 함수는 반환값이 필요합니다.", node.span);
        return false;
      case "BreakStatement":
      case "ContinueStatement":
        if (loopDepth === 0)
          report("GE3004", "반복문 밖에서는 중단 또는 계속을 사용할 수 없습니다.", node.span);
        return false;
      case "BlockStatement":
        return block(node, returnType, loopDepth);
      case "IfStatement": {
        condition(node.condition);
        const thenFallsThrough = block(node.thenBranch, returnType, loopDepth);
        const elseFallsThrough = node.elseBranch
          ? statement(node.elseBranch, returnType, loopDepth)
          : true;
        return thenFallsThrough || elseFallsThrough;
      }
      case "WhileStatement":
        condition(node.condition);
        block(node.body, returnType, loopDepth + 1);
        return true;
    }
  }
  for (const fn of program.ast.functions) {
    const returnType = typeFromNode(fn.returnType);
    const fallsThrough = block(fn.body, returnType, 0);
    if (fallsThrough && !primitive(returnType, "없음"))
      report(
        "GE3005",
        `함수 '${fn.name.raw}'의 도달 가능한 경로에 반환값이 없습니다.`,
        fn.name.span,
      );
  }
  const limited = limitDiagnostics(diagnostics, resolution.suppressedCount);
  if (limited.diagnostics.length > 0 || program.entrypoint === null)
    return { success: false, ...limited };
  return {
    success: true,
    diagnostics: [],
    suppressedCount: 0,
    program: {
      ...program,
      entrypoint: program.entrypoint,
      checked: true,
      expressionTypes,
      symbolTypes,
      signedMinimumLiterals,
    },
  };
}
