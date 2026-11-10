import { visitAst, type IdentifierName, type SourceSpan } from "@geulion/ast";
import type {
  FunctionSymbol,
  LexicalScope,
  ProjectTypedProgram,
  SemanticSymbol,
  TypedProgram,
} from "@geulion/semantic";
import { generateJavaScript } from "./generator.js";

export interface TypedProjectModuleInput {
  readonly path: string;
  readonly program: ProjectTypedProgram;
}

export interface ProjectSourceText {
  readonly path: string;
  readonly text: string;
}

export interface ProjectJavaScriptInput {
  readonly entryPath: string;
  readonly modules: readonly TypedProjectModuleInput[];
  readonly sources: readonly ProjectSourceText[];
}

export interface ProjectJavaScriptOptions {
  readonly target?: "node" | "browser";
  readonly fileName?: string;
}

interface ModuleIdentityMap {
  readonly input: TypedProjectModuleInput;
  readonly symbolIds: ReadonlyMap<number, number>;
  readonly scopeIds: ReadonlyMap<number, number>;
}

function combineProjectModules(input: ProjectJavaScriptInput): {
  readonly program: ProjectTypedProgram;
  readonly sourcePathBySpan: (span: SourceSpan) => string;
} {
  const modules = [...input.modules].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const modulesByPath = new Map(modules.map((module) => [module.path, module]));
  const entryModule = modulesByPath.get(input.entryPath);
  if (!entryModule) throw new Error("Project code generation requires the entry module");

  let nextSymbolId = 0;
  let nextScopeId = 1;
  const identityMaps: ModuleIdentityMap[] = modules.map((module) => {
    const symbolIds = new Map<number, number>();
    for (const symbolId of [...module.program.symbols.keys()].sort((left, right) => left - right))
      symbolIds.set(symbolId, nextSymbolId++);

    const scopeIds = new Map<number, number>();
    const scopeKeys = [...module.program.scopes.keys()].sort((left, right) => left - right);
    for (const scopeId of scopeKeys) scopeIds.set(scopeId, scopeId === 0 ? 0 : nextScopeId++);
    return { input: module, symbolIds, scopeIds };
  });
  const mapsByPath = new Map(identityMaps.map((mapping) => [mapping.input.path, mapping]));

  function targetSymbolId(module: TypedProjectModuleInput, symbol: SemanticSymbol): number {
    if (symbol.kind === "function" && symbol.declaration !== null && symbol.sourcePath !== null) {
      const target = modulesByPath.get(symbol.sourcePath);
      const targetMap = mapsByPath.get(symbol.sourcePath);
      const targetFunction = target?.program.functions.get(symbol.name);
      if (targetMap && targetFunction?.declaration === symbol.declaration) {
        const resolvedId = targetMap.symbolIds.get(targetFunction.id);
        if (resolvedId !== undefined) return resolvedId;
      }
    }
    const localId = mapsByPath.get(module.path)?.symbolIds.get(symbol.id);
    if (localId === undefined) throw new Error("Project symbol is missing its module identity");
    return localId;
  }

  const symbols = new Map<number, SemanticSymbol>();
  const scopes = new Map<number, LexicalScope>();
  const references = new Map<IdentifierName, number>();
  const functions = new Map<string, FunctionSymbol>();
  const exports: FunctionSymbol[] = [];
  const expressionTypes = new Map<
    TypedProgram["expressionTypes"] extends ReadonlyMap<infer K, unknown> ? K : never,
    import("@geulion/semantic").GeulType
  >();
  const symbolTypes = new Map<number, import("@geulion/semantic").GeulType>();
  const signedMinimumLiterals = new Set<
    TypedProgram["signedMinimumLiterals"] extends ReadonlySet<infer T> ? T : never
  >();
  const sourcePaths = new WeakMap<SourceSpan, string>();

  for (const identity of identityMaps) {
    const { input: module } = identity;
    const remappedForModule = new Map<number, number>();
    for (const symbol of module.program.symbols.values()) {
      const id = identity.symbolIds.get(symbol.id);
      if (id === undefined) throw new Error("Project symbol identity map is incomplete");
      remappedForModule.set(symbol.id, targetSymbolId(module, symbol));
      symbols.set(id, { ...symbol, id, scopeId: identity.scopeIds.get(symbol.scopeId) ?? 0 });
    }

    for (const [name, id] of module.program.references) {
      const symbol = module.program.symbols.get(id);
      if (!symbol) throw new Error("Checked project reference has no symbol");
      references.set(name, targetSymbolId(module, symbol));
    }
    for (const [name, symbol] of module.program.functions)
      functions.set(`${module.path}\u0000${name}`, {
        ...symbol,
        id: targetSymbolId(module, symbol),
        scopeId: identity.scopeIds.get(symbol.scopeId) ?? 0,
      });
    for (const [scopeId, scope] of module.program.scopes) {
      const id = identity.scopeIds.get(scopeId);
      if (id === undefined) continue;
      scopes.set(id, {
        ...scope,
        id,
        parent: scope.parent === null ? null : (identity.scopeIds.get(scope.parent) ?? 0),
        bindings: new Map(
          [...scope.bindings].map(([name, symbolId]) => [
            name,
            identity.symbolIds.get(symbolId) ?? symbolId,
          ]),
        ),
      });
    }
    for (const [expression, type] of module.program.expressionTypes)
      expressionTypes.set(expression, type);
    for (const [symbolId, type] of module.program.symbolTypes) {
      const remappedId = identity.symbolIds.get(symbolId);
      if (remappedId !== undefined) symbolTypes.set(remappedId, type);
    }
    module.program.signedMinimumLiterals.forEach((expression) =>
      signedMinimumLiterals.add(expression),
    );
    visitAst(module.program.ast, (node) => sourcePaths.set(node.span, module.path));
    for (const fn of module.program.ast.functions) {
      sourcePaths.set(fn.name.span, module.path);
      for (const parameter of fn.parameters) sourcePaths.set(parameter.name.span, module.path);
    }
  }

  const entryIdentity = mapsByPath.get(input.entryPath);
  const entrypoint = entryModule.program.entrypoint;
  const remappedEntrypoint = entrypoint ? entryIdentity?.symbolIds.get(entrypoint.id) : undefined;
  if (entrypoint && remappedEntrypoint === undefined)
    throw new Error("Project entrypoint is missing its global identity");
  if (entrypoint) sourcePaths.set(entrypoint.span ?? entryModule.program.ast.span, input.entryPath);
  for (const symbol of entryModule.program.exports) {
    const id = targetSymbolId(entryModule, symbol);
    const remapped = symbols.get(id);
    if (!remapped || remapped.kind !== "function")
      throw new Error("Project export is missing its global identity");
    exports.push(remapped);
  }

  return {
    program: {
      checked: true,
      ast: {
        kind: "Program",
        imports: [],
        functions: modules.flatMap(({ program }) => program.ast.functions),
        span: entryModule.program.ast.span,
      },
      path: input.entryPath,
      symbols,
      scopes,
      references,
      functions,
      exports,
      entrypoint:
        remappedEntrypoint === undefined
          ? null
          : (symbols.get(remappedEntrypoint) as FunctionSymbol),
      expressionTypes,
      symbolTypes,
      signedMinimumLiterals,
    },
    sourcePathBySpan: (span) => sourcePaths.get(span) ?? input.entryPath,
  };
}

/** Combines a checked project into one deterministic Node or browser artifact. */
export function generateProjectJavaScript(
  input: ProjectJavaScriptInput,
  options: ProjectJavaScriptOptions = {},
) {
  const combined = combineProjectModules(input);
  const sourceFiles = [...input.sources].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  if (sourceFiles.length !== input.modules.length)
    throw new Error("Project source text must be provided for every analyzed module");
  return generateJavaScript(combined.program, {
    target: options.target ?? "node",
    ...(options.fileName === undefined ? {} : { fileName: options.fileName }),
    sourceFiles,
    sourcePathBySpan: combined.sourcePathBySpan,
  });
}
