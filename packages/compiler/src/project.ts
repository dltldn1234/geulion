import {
  SourceFile,
  createDiagnostic,
  type Diagnostic,
  type ImportDeclarationNode,
  type ProgramNode,
  type SourceSpan,
} from "@geulion/ast";
import {
  analyzeProgram,
  type FunctionSymbol,
  type ProjectAnalysisResult,
  type ProjectImportResolution,
  type ProjectResolutionOptions,
  typeFromNode,
} from "@geulion/semantic";
import { parseSource } from "./frontend.js";
import { generateProjectJavaScript } from "@geulion/codegen-js";

/** Source map keys and entryPath are canonical, root-relative `.geul` paths. */
export interface ProjectSourceInput {
  readonly entryPath: string;
  /** Absolute host path identifying the project root; this loader performs no filesystem I/O. */
  readonly rootPath: string;
  readonly sources: ReadonlyMap<string, Uint8Array>;
  readonly languageVersion: "0.4";
}

export interface ProjectModule {
  readonly path: string;
  readonly source: Uint8Array;
  readonly ast: ProgramNode;
  readonly imports: readonly ProjectModuleImport[];
}

export interface ProjectModuleImport {
  readonly path: string;
  readonly alias: ImportDeclarationNode["alias"];
  readonly pathSpan: ImportDeclarationNode["pathSpan"];
}

export interface ProjectSourceGraph {
  readonly entryPath: string;
  readonly rootPath: string;
  /** Modules sorted by canonical project-relative path. */
  readonly modules: readonly ProjectModule[];
}

export interface ProjectSourceGraphSuccess {
  readonly success: true;
  readonly graph: ProjectSourceGraph;
  readonly diagnostics: readonly [];
  readonly suppressedCount: 0;
}

export interface ProjectSourceGraphFailure {
  readonly success: false;
  readonly diagnostics: readonly Diagnostic[];
  readonly suppressedCount: number;
}

export type ProjectSourceGraphResult = ProjectSourceGraphSuccess | ProjectSourceGraphFailure;

export interface TypedProjectModule {
  readonly path: string;
  readonly program: Extract<ProjectAnalysisResult, { success: true }>["program"];
}

export type ProjectAnalysis =
  | {
      readonly success: true;
      readonly modules: readonly TypedProjectModule[];
      readonly diagnostics: readonly [];
      readonly suppressedCount: 0;
    }
  | {
      readonly success: false;
      readonly diagnostics: readonly Diagnostic[];
      readonly suppressedCount: number;
    };

export type ProjectCompilationResult =
  | ({
      readonly success: true;
      readonly diagnostics: readonly [];
      readonly suppressedCount: 0;
    } & ReturnType<typeof generateProjectJavaScript>)
  | {
      readonly success: false;
      readonly diagnostics: readonly Diagnostic[];
      readonly suppressedCount: number;
    };

type PathFailure = {
  readonly code: "GE2006" | "GE2007";
  readonly message: string;
  readonly help: string;
};

type ResolvedImport = { readonly path: string } | PathFailure;

type PendingModule = {
  readonly path: string;
  readonly requestedBy: {
    readonly importerPath: string;
    readonly declaration: ImportDeclarationNode;
  } | null;
};

const MAX_DIAGNOSTICS = 100;

function moduleFunctionSymbols(module: ProjectModule): {
  readonly functions: ReadonlyMap<string, FunctionSymbol>;
  readonly exports: ReadonlyMap<string, FunctionSymbol>;
} {
  const functions = new Map<string, FunctionSymbol>();
  const exports = new Map<string, FunctionSymbol>();
  for (const [index, declaration] of module.ast.functions.entries()) {
    const name = declaration.name.normalized;
    if (functions.has(name)) continue;
    const symbol: FunctionSymbol = {
      id: index,
      name,
      kind: "function",
      scopeId: 0,
      span: declaration.name.span,
      declaration,
      sourcePath: module.path,
      signature: {
        parameters: declaration.parameters.map((parameter) => typeFromNode(parameter.type)),
        returnType: typeFromNode(declaration.returnType),
      },
    };
    functions.set(name, symbol);
    if (declaration.visibility === "public") exports.set(name, symbol);
  }
  return { functions, exports };
}

/** Resolves and type-checks every module after collecting the complete signature graph. */
export function analyzeProjectSourceGraph(
  graph: ProjectSourceGraph,
  target: "node" | "browser" = "node",
): ProjectAnalysis {
  const symbols = new Map(
    graph.modules.map((module) => [module.path, moduleFunctionSymbols(module)]),
  );
  const results: TypedProjectModule[] = [];
  const diagnostics: Diagnostic[] = [];
  let suppressedCount = 0;

  for (const module of graph.modules) {
    const imports: ProjectImportResolution[] = [];
    for (const projectImport of module.imports) {
      const target = symbols.get(projectImport.path);
      if (target) imports.push({ path: projectImport.path, alias: projectImport.alias, ...target });
      else
        diagnostics.push(
          createDiagnostic({
            code: "GE2006",
            phase: "resolve",
            message: `가져온 모듈 '${projectImport.path}'이(가) 프로젝트 그래프에 없습니다.`,
            path: module.path,
            range: projectImport.pathSpan,
            help: "프로젝트 source graph를 다시 불러오세요.",
          }),
        );
    }
    const options: ProjectResolutionOptions = {
      imports,
      entrypoint:
        module.path !== graph.entryPath ? "forbidden" : target === "node" ? "required" : "optional",
    };
    const result = analyzeProgram(module.ast, module.path, "0.4", options);
    if (result.success) results.push({ path: module.path, program: result.program });
    else {
      diagnostics.push(...result.diagnostics);
      suppressedCount += result.suppressedCount;
    }
  }

  if (
    target === "browser" &&
    !results.find(({ path }) => path === graph.entryPath)?.program.exports.length
  )
    diagnostics.push(
      createDiagnostic({
        code: "GE2005",
        phase: "resolve",
        message: "브라우저 프로젝트의 진입 모듈에는 공개 함수가 하나 이상 필요합니다.",
        path: graph.entryPath,
        range: null,
        help: "진입 모듈에 `공개 함수` 선언을 하나 이상 추가하세요.",
      }),
    );
  const limited = diagnostics.slice(0, MAX_DIAGNOSTICS);
  suppressedCount += Math.max(0, diagnostics.length - MAX_DIAGNOSTICS);
  if (limited.length > 0 || suppressedCount > 0)
    return { success: false, diagnostics: limited, suppressedCount };
  return { success: true, modules: results, diagnostics: [], suppressedCount: 0 };
}

/** Checks a v0.4 project graph and emits one deterministic in-memory artifact. */
export function compileProjectSourceGraph(
  graph: ProjectSourceGraph,
  target: "node" | "browser" = "node",
): ProjectCompilationResult {
  const analysis = analyzeProjectSourceGraph(graph, target);
  if (!analysis.success) return analysis;
  const sources = graph.modules.map(({ path, source }) => ({
    path,
    text: SourceFile.fromBytes(path, source).text,
  }));
  const generated = generateProjectJavaScript(
    { entryPath: graph.entryPath, modules: analysis.modules, sources },
    { target },
  );
  return { success: true, ...generated, diagnostics: [], suppressedCount: 0 };
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isCanonicalProjectPath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || !path.endsWith(".geul"))
    return false;
  if (hasControlCharacter(path)) return false;
  return path
    .split("/")
    .every((component) => component.length > 0 && component !== "." && component !== "..");
}

function resolveImportPath(importerPath: string, importPath: string): ResolvedImport {
  if (
    (!importPath.startsWith("./") && !importPath.startsWith("../")) ||
    !importPath.endsWith(".geul") ||
    importPath.includes("\\") ||
    hasControlCharacter(importPath) ||
    importPath.includes("//")
  ) {
    return {
      code: "GE2006",
      message: `유효하지 않은 모듈 경로 '${importPath}'입니다.`,
      help: "`./` 또는 `../`로 시작하고 `.geul`로 끝나는 경로를 사용하세요. 경로 구분자는 `/`입니다.",
    };
  }

  const components = importerPath.split("/").slice(0, -1);
  for (const component of importPath.split("/")) {
    if (component.length === 0 || component === ".") continue;
    if (component === "..") {
      if (components.length === 0) {
        return {
          code: "GE2007",
          message: `모듈 경로 '${importPath}'가 프로젝트 루트 밖을 가리킵니다.`,
          help: "가져올 모듈이 프로젝트 루트 안에 있도록 상대 경로를 고치세요.",
        };
      }
      components.pop();
      continue;
    }
    components.push(component);
  }

  const path = components.join("/");
  if (!isCanonicalProjectPath(path)) {
    return {
      code: "GE2006",
      message: `유효하지 않은 모듈 경로 '${importPath}'입니다.`,
      help: "`./` 또는 `../`로 시작하고 `.geul`로 끝나는 경로를 사용하세요.",
    };
  }
  return { path };
}

function diagnostic(
  code: "GE2006" | "GE2007" | "GE2008",
  message: string,
  path: string,
  range: SourceSpan | null,
  help: string,
  related: readonly {
    readonly message: string;
    readonly path: string;
    readonly range: SourceSpan;
  }[] = [],
): Diagnostic {
  return createDiagnostic({
    code,
    phase: "resolve",
    message,
    path,
    range,
    help,
    related,
  });
}

/**
 * Loads and parses the entry module's reachable import closure from an in-memory
 * source map. It never reads files and does not resolve exports or type-check calls.
 */
export function loadProjectSourceGraph(input: ProjectSourceInput): ProjectSourceGraphResult {
  if (!isCanonicalProjectPath(input.entryPath)) {
    return {
      success: false,
      diagnostics: [
        diagnostic(
          "GE2006",
          `프로젝트 진입 경로 '${input.entryPath}'가 canonical root-relative .geul 경로가 아닙니다.`,
          input.entryPath,
          null,
          "프로젝트 루트 기준의 정규화된 `.geul` 상대 경로를 지정하세요.",
        ),
      ],
      suppressedCount: 0,
    };
  }

  const diagnostics: Diagnostic[] = [];
  let suppressedCount = 0;
  const append = (items: readonly Diagnostic[]) => {
    for (const item of items) {
      if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(item);
      else suppressedCount += 1;
    }
  };

  const modules = new Map<string, ProjectModule>();
  const visited = new Set<string>();
  const pending: PendingModule[] = [{ path: input.entryPath, requestedBy: null }];

  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const item = pending[cursor];
    if (item === undefined || visited.has(item.path)) continue;
    visited.add(item.path);

    const source = input.sources.get(item.path);
    if (source === undefined) {
      if (item.requestedBy === null) {
        append([
          diagnostic(
            "GE2006",
            `프로젝트 진입 모듈 '${item.path}'을(를) source map에서 찾을 수 없습니다.`,
            item.path,
            null,
            "진입 모듈을 source map에 추가하거나 entryPath를 확인하세요.",
          ),
        ]);
      } else {
        append([
          diagnostic(
            "GE2006",
            `가져온 모듈 '${item.path}'을(를) source map에서 찾을 수 없습니다.`,
            item.requestedBy.importerPath,
            item.requestedBy.declaration.pathSpan,
            "경로를 확인하고 해당 모듈을 프로젝트 source map에 추가하세요.",
          ),
        ]);
      }
      continue;
    }

    const parsed = parseSource({ path: item.path, source });
    if (!parsed.success) {
      append(parsed.diagnostics);
      suppressedCount += parsed.suppressedCount;
      continue;
    }

    const importsByPath = new Map<string, ImportDeclarationNode>();
    const importsByAlias = new Map<string, ImportDeclarationNode>();
    const resolvedImports: ProjectModuleImport[] = [];
    for (const declaration of parsed.ast.imports) {
      const resolved = resolveImportPath(item.path, declaration.path);
      if ("code" in resolved) {
        append([
          diagnostic(
            resolved.code,
            resolved.message,
            item.path,
            declaration.pathSpan,
            resolved.help,
          ),
        ]);
        continue;
      }

      const previousPath = importsByPath.get(resolved.path);
      const previousAlias = importsByAlias.get(declaration.alias.normalized);
      if (previousPath || previousAlias) {
        const previous = previousPath ?? previousAlias;
        append([
          diagnostic(
            "GE2008",
            previousPath
              ? `모듈 '${resolved.path}'을(를) 한 파일에서 두 번 가져올 수 없습니다.`
              : `모듈 별칭 '${declaration.alias.raw}'이(가) 중복되었습니다.`,
            item.path,
            previousPath ? declaration.pathSpan : declaration.alias.span,
            "각 모듈 경로와 별칭을 한 번씩만 선언하세요.",
            previous
              ? [{ message: "첫 번째 import 선언입니다.", path: item.path, range: previous.span }]
              : [],
          ),
        ]);
        continue;
      }

      importsByPath.set(resolved.path, declaration);
      importsByAlias.set(declaration.alias.normalized, declaration);
      resolvedImports.push({
        path: resolved.path,
        alias: declaration.alias,
        pathSpan: declaration.pathSpan,
      });
      pending.push({ path: resolved.path, requestedBy: { importerPath: item.path, declaration } });
    }

    modules.set(item.path, {
      path: item.path,
      source: source.slice(),
      ast: parsed.ast,
      imports: resolvedImports,
    });
  }

  if (diagnostics.length > 0 || suppressedCount > 0) {
    return { success: false, diagnostics, suppressedCount };
  }

  const orderedModules = [...modules.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return {
    success: true,
    graph: {
      entryPath: input.entryPath,
      rootPath: input.rootPath,
      modules: orderedModules,
    },
    diagnostics: [],
    suppressedCount: 0,
  };
}
