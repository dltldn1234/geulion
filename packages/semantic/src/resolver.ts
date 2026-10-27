import {
  createDiagnostic,
  type Diagnostic,
  type FunctionDeclarationNode,
  type IdentifierName,
  type ProgramNode,
  type SourceSpan,
  type BlockStatementNode,
  type ExpressionNode,
  type StatementNode,
} from "@geulion/ast";
import { typeFromNode, type GeulType, UNIT, INTEGER, REAL } from "./types.js";
import { limitDiagnostics } from "./diagnostics.js";

export type SymbolId = number;
export type ScopeId = number;

export interface FunctionSignature {
  /** A null parameter is the single built-in polymorphic 출력 argument. */
  readonly parameters: readonly (GeulType | null)[];
  readonly returnType: GeulType;
}

interface SymbolBase {
  readonly id: SymbolId;
  readonly name: string;
  readonly span: SourceSpan | null;
  readonly scopeId: ScopeId;
}

export interface FunctionSymbol extends SymbolBase {
  readonly kind: "function" | "prelude";
  readonly signature: FunctionSignature;
  readonly declaration: FunctionDeclarationNode | null;
}

export interface ValueSymbol extends SymbolBase {
  readonly kind: "parameter" | "variable" | "constant";
  readonly mutable: boolean;
  readonly annotation: GeulType | null;
}

export type SemanticSymbol = FunctionSymbol | ValueSymbol;

export interface LexicalScope {
  readonly id: ScopeId;
  readonly parent: ScopeId | null;
  readonly bindings: ReadonlyMap<string, SymbolId>;
}

export interface ResolvedProgram {
  readonly ast: ProgramNode;
  readonly path: string;
  readonly symbols: ReadonlyMap<SymbolId, SemanticSymbol>;
  readonly scopes: ReadonlyMap<ScopeId, LexicalScope>;
  readonly references: ReadonlyMap<IdentifierName, SymbolId>;
  readonly functions: ReadonlyMap<string, FunctionSymbol>;
  readonly entrypoint: FunctionSymbol | null;
}

export interface ResolutionResult {
  readonly success: boolean;
  readonly program: ResolvedProgram;
  readonly diagnostics: readonly Diagnostic[];
  readonly suppressedCount: number;
}

export function resolveProgram(ast: ProgramNode, path = "<stdin>"): ResolutionResult {
  const symbols = new Map<SymbolId, SemanticSymbol>();
  const scopes = new Map<ScopeId, LexicalScope>();
  const references = new Map<IdentifierName, SymbolId>();
  const functions = new Map<string, FunctionSymbol>();
  const diagnostics: Diagnostic[] = [];
  let symbolId = 0;
  let scopeId = 0;

  function report(
    code: "GE2001" | "GE2002" | "GE2003",
    message: string,
    span: SourceSpan,
    prior?: SemanticSymbol,
  ) {
    diagnostics.push(
      createDiagnostic({
        code,
        phase: "resolve",
        message,
        path,
        range: span,
        help:
          code === "GE2003"
            ? "정확히 하나의 `함수 시작() -> 없음`을 선언하세요."
            : "현재 범위의 선언과 이름을 확인하세요.",
        related: prior?.span
          ? [{ message: "이전에 선언한 위치입니다.", path, range: prior.span }]
          : [],
      }),
    );
  }

  for (const [name, parameters, returnType] of [
    ["출력", [null], UNIT],
    ["정수로", [REAL], INTEGER],
    ["실수로", [INTEGER], REAL],
  ] as const) {
    const symbol: FunctionSymbol = {
      id: symbolId++,
      name,
      kind: "prelude",
      scopeId: 0,
      span: null,
      declaration: null,
      signature: { parameters, returnType },
    };
    functions.set(name, symbol);
    symbols.set(symbol.id, symbol);
  }
  scopes.set(0, { id: 0, parent: null, bindings: new Map() });
  for (const declaration of ast.functions) {
    const name = declaration.name.normalized;
    const symbol: FunctionSymbol = {
      id: symbolId++,
      name,
      kind: "function",
      scopeId: 0,
      span: declaration.name.span,
      declaration,
      signature: {
        parameters: declaration.parameters.map((p) => typeFromNode(p.type)),
        returnType: typeFromNode(declaration.returnType),
      },
    };
    symbols.set(symbol.id, symbol);
    references.set(declaration.name, symbol.id);
    const previous = functions.get(name);
    if (previous)
      report(
        "GE2002",
        `함수 이름 '${name}'이 이미 선언되어 있습니다.`,
        declaration.name.span,
        previous,
      );
    else functions.set(name, symbol);
  }

  const entries = ast.functions.filter((f) => f.name.normalized === "시작");
  if (entries.length === 0) report("GE2003", "진입 함수 '시작'이 없습니다.", ast.span);
  for (const [index, entry] of entries.entries()) {
    const type = typeFromNode(entry.returnType);
    if (
      index > 0 ||
      entry.parameters.length !== 0 ||
      type.kind !== "primitive" ||
      type.name !== "없음"
    ) {
      report(
        "GE2003",
        "진입 함수는 유일한 `시작() -> 없음`이어야 합니다.",
        entry.name.span,
        index > 0 ? functions.get("시작") : undefined,
      );
    }
  }

  interface MutableScope {
    id: ScopeId;
    parent: MutableScope | null;
    bindings: Map<string, SymbolId>;
  }
  function makeScope(parent: MutableScope | null): MutableScope {
    const scope = { id: ++scopeId, parent, bindings: new Map<string, SymbolId>() };
    scopes.set(scope.id, { id: scope.id, parent: parent?.id ?? 0, bindings: scope.bindings });
    return scope;
  }
  function lookup(name: string, scope: MutableScope): SemanticSymbol | undefined {
    let current: MutableScope | null = scope;
    while (current) {
      const id = current.bindings.get(name);
      if (id !== undefined) return symbols.get(id);
      current = current.parent;
    }
    return functions.get(name);
  }
  function use(name: IdentifierName, scope: MutableScope, call = false) {
    const symbol = call ? functions.get(name.normalized) : lookup(name.normalized, scope);
    if (!symbol) report("GE2001", `정의되지 않은 이름 '${name.raw}'입니다.`, name.span);
    else references.set(name, symbol.id);
  }
  function declare(
    name: IdentifierName,
    kind: ValueSymbol["kind"],
    annotation: GeulType | null,
    scope: MutableScope,
  ) {
    const priorId = scope.bindings.get(name.normalized);
    const prior = priorId === undefined ? functions.get(name.normalized) : symbols.get(priorId);
    const symbol: ValueSymbol = {
      id: symbolId++,
      name: name.normalized,
      span: name.span,
      kind,
      mutable: kind === "variable",
      annotation,
      scopeId: scope.id,
    };
    symbols.set(symbol.id, symbol);
    references.set(name, symbol.id);
    if (prior)
      report(
        "GE2002",
        `이름 '${name.raw}'이 이미 선언되어 있거나 함수 이름과 충돌합니다.`,
        name.span,
        prior,
      );
    else scope.bindings.set(name.normalized, symbol.id);
  }
  function expression(node: ExpressionNode, scope: MutableScope): void {
    switch (node.kind) {
      case "IdentifierExpression":
        use(node.name, scope);
        return;
      case "CallExpression":
        use(node.callee, scope, true);
        node.arguments.forEach((n) => expression(n, scope));
        return;
      case "GroupingExpression":
        expression(node.expression, scope);
        return;
      case "UnaryExpression":
        expression(node.operand, scope);
        return;
      case "BinaryExpression":
        expression(node.left, scope);
        expression(node.right, scope);
        return;
      case "IndexExpression":
        expression(node.target, scope);
        expression(node.index, scope);
        return;
      case "ListExpression":
        node.elements.forEach((n) => expression(n, scope));
        return;
      case "DictionaryExpression":
        node.entries.forEach((n) => expression(n.value, scope));
        return;
      case "SomeExpression":
        expression(node.value, scope);
        return;
      default:
        return;
    }
  }
  function block(node: BlockStatementNode, scope: MutableScope, nested = true): void {
    const current = nested ? makeScope(scope) : scope;
    node.statements.forEach((n) => statement(n, current));
  }
  function statement(node: StatementNode, scope: MutableScope): void {
    switch (node.kind) {
      case "VariableDeclaration":
        expression(node.initializer, scope);
        declare(
          node.name,
          node.mutable ? "variable" : "constant",
          node.annotation ? typeFromNode(node.annotation) : null,
          scope,
        );
        return;
      case "Assignment":
        use(node.target, scope);
        expression(node.value, scope);
        return;
      case "IfStatement":
        expression(node.condition, scope);
        block(node.thenBranch, scope);
        if (node.elseBranch) statement(node.elseBranch, scope);
        return;
      case "WhileStatement":
        expression(node.condition, scope);
        block(node.body, scope);
        return;
      case "BlockStatement":
        block(node, scope);
        return;
      case "ReturnStatement":
        if (node.value) expression(node.value, scope);
        return;
      case "ExpressionStatement":
        expression(node.expression, scope);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
    }
  }
  for (const declaration of ast.functions) {
    const scope = makeScope(null);
    declaration.parameters.forEach((p) =>
      declare(p.name, "parameter", typeFromNode(p.type), scope),
    );
    block(declaration.body, scope, false);
  }
  const limited = limitDiagnostics(diagnostics);
  return {
    success: limited.diagnostics.length === 0,
    program: {
      ast,
      path,
      symbols,
      scopes,
      references,
      functions,
      entrypoint: entries.length === 1 ? (functions.get("시작") ?? null) : null,
    },
    ...limited,
  };
}
