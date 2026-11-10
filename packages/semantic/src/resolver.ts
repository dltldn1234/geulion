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
import { typeFromNode, type GeulType, UNIT, INTEGER, REAL, STRING, BOOLEAN } from "./types.js";
import { limitDiagnostics } from "./diagnostics.js";

export type SymbolId = number;
export type ScopeId = number;
export type LanguageVersion = "0.1" | "0.2" | "0.3" | "0.4";

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
  readonly sourcePath: string | null;
}

export interface ProjectImportResolution {
  readonly path: string;
  readonly alias: IdentifierName;
  readonly functions: ReadonlyMap<string, FunctionSymbol>;
  readonly exports: ReadonlyMap<string, FunctionSymbol>;
}

export interface ProjectResolutionOptions {
  readonly imports: readonly ProjectImportResolution[];
  readonly entrypoint: "required" | "optional" | "forbidden";
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
  /** Explicit public functions in source declaration order. */
  readonly exports: readonly FunctionSymbol[];
  readonly entrypoint: FunctionSymbol | null;
}

export interface ResolutionResult {
  readonly success: boolean;
  readonly program: ResolvedProgram;
  readonly diagnostics: readonly Diagnostic[];
  readonly suppressedCount: number;
}

export function resolveProgram(
  ast: ProgramNode,
  path = "<stdin>",
  languageVersion: LanguageVersion = "0.1",
  project?: ProjectResolutionOptions,
): ResolutionResult {
  const symbols = new Map<SymbolId, SemanticSymbol>();
  const scopes = new Map<ScopeId, LexicalScope>();
  const references = new Map<IdentifierName, SymbolId>();
  const functions = new Map<string, FunctionSymbol>();
  const exports: FunctionSymbol[] = [];
  const diagnostics: Diagnostic[] = [];
  let symbolId = 0;
  let scopeId = 0;

  function report(
    code: "GE2001" | "GE2002" | "GE2003" | "GE2004" | "GE2008" | "GE2009" | "GE2010" | "GE2011",
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
            ? "정확히 하나의 비공개 `함수 시작() -> 없음`을 선언하세요."
            : code === "GE2004"
              ? "`--language-version 0.3` 또는 `0.4`를 선택하세요."
              : code === "GE2011"
                ? "모듈 문법은 아직 프로젝트 컴파일에서만 지원됩니다. 단일 파일 검사에는 v0.1-v0.3 문법을 사용하세요."
                : "현재 범위의 선언과 이름을 확인하세요.",
        related: prior?.span
          ? [
              {
                message: "이전에 선언한 위치입니다.",
                path:
                  prior.kind === "function" || prior.kind === "prelude"
                    ? (prior.sourcePath ?? path)
                    : path,
                range: prior.span,
              },
            ]
          : [],
      }),
    );
  }

  if (!project)
    for (const declaration of ast.imports)
      report("GE2011", "단일 파일 컴파일은 다른 모듈을 가져올 수 없습니다.", declaration.pathSpan);

  const prelude: [string, readonly (GeulType | null)[], GeulType][] = [
    ["출력", [null], UNIT],
    ["정수로", [REAL], INTEGER],
    ["실수로", [INTEGER], REAL],
  ];
  if (languageVersion === "0.2" || languageVersion === "0.3" || languageVersion === "0.4") {
    prelude.push(
      ["문자열길이", [STRING], INTEGER],
      ["문자열포함", [STRING, STRING], BOOLEAN],
      ["문자열시작", [STRING, STRING], BOOLEAN],
      ["문자열끝", [STRING, STRING], BOOLEAN],
    );
  }
  for (const [name, parameters, returnType] of prelude) {
    const symbol: FunctionSymbol = {
      id: symbolId++,
      name,
      kind: "prelude",
      scopeId: 0,
      span: null,
      declaration: null,
      sourcePath: null,
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
      sourcePath: path,
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
        project ? "GE2008" : "GE2002",
        `함수 이름 '${name}'이 이미 선언되어 있습니다.`,
        declaration.name.span,
        previous,
      );
    else {
      functions.set(name, symbol);
      if (declaration.visibility === "public") {
        if (languageVersion === "0.3" || languageVersion === "0.4") exports.push(symbol);
        else {
          report(
            "GE2004",
            "`공개 함수` 선언은 언어 버전 0.3에서만 사용할 수 있습니다.",
            declaration.name.span,
          );
        }
      }
    }
  }

  const importedModules = new Map<string, ProjectImportResolution>();
  for (const imported of project?.imports ?? []) {
    const alias = imported.alias.normalized;
    importedModules.set(alias, imported);
    const prior = functions.get(alias);
    if (prior) {
      report(
        "GE2008",
        `모듈 별칭 '${imported.alias.raw}'이(가) 기존 함수 또는 prelude 이름과 충돌합니다.`,
        imported.alias.span,
        prior,
      );
    }
  }

  const entries = ast.functions.filter((f) => f.name.normalized === "시작");
  if (project) {
    if (project.entrypoint === "required" && entries.length === 0)
      report("GE2010", "진입 모듈에 진입 함수 '시작'이 없습니다.", ast.span);
    if (project.entrypoint === "forbidden" && entries.length > 0)
      report(
        "GE2010",
        "가져온 모듈은 진입 함수 '시작'을 선언할 수 없습니다.",
        entries[0]!.name.span,
      );
  } else if (entries.length === 0) report("GE2003", "진입 함수 '시작'이 없습니다.", ast.span);
  for (const [index, entry] of entries.entries()) {
    const type = typeFromNode(entry.returnType);
    if (
      index > 0 ||
      entry.visibility === "public" ||
      entry.parameters.length !== 0 ||
      type.kind !== "primitive" ||
      type.name !== "없음"
    ) {
      report(
        project ? "GE2010" : "GE2003",
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
  function useQualified(namespace: IdentifierName, name: IdentifierName) {
    const imported = importedModules.get(namespace.normalized);
    if (!imported) {
      report("GE2009", `가져오지 않은 모듈 별칭 '${namespace.raw}'입니다.`, namespace.span);
      return;
    }
    const target = imported.functions.get(name.normalized);
    const exported = imported.exports.get(name.normalized);
    if (!exported || name.normalized === "시작") {
      const privateFunction = target?.declaration?.visibility === "private" ? target : undefined;
      const memberName = privateFunction ? "비공개 함수" : "공개 함수";
      const diagnostic = createDiagnostic({
        code: "GE2009",
        phase: "resolve",
        message: `모듈 '${namespace.raw}'에 가져올 수 있는 ${memberName} '${name.raw}'이(가) 없습니다.`,
        path,
        range: name.span,
        help: "가져온 모듈의 공개 함수 이름을 확인하세요.",
        related: privateFunction?.span
          ? [{ message: "대상 함수 선언입니다.", path: imported.path, range: privateFunction.span }]
          : [],
      });
      diagnostics.push(diagnostic);
      return;
    }

    const importedSymbol: FunctionSymbol = { ...exported, id: symbolId++, scopeId: 0 };
    symbols.set(importedSymbol.id, importedSymbol);
    references.set(name, importedSymbol.id);
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
        if (node.namespace !== null) {
          if (project) useQualified(node.namespace, node.callee);
          else
            report(
              "GE2011",
              "한정 함수 호출은 아직 프로젝트 컴파일에서 지원되지 않습니다.",
              node.namespace.span,
            );
        } else use(node.callee, scope, true);
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
      exports,
      entrypoint:
        entries.length === 1 && entries[0]?.visibility === "private"
          ? (functions.get("시작") ?? null)
          : null,
    },
    ...limited,
  };
}
