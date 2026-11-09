import {
  createDiagnostic,
  type Diagnostic,
  type ImportDeclarationNode,
  type ProgramNode,
  type SourceSpan,
} from "@geulion/ast";
import { parseSource } from "./frontend.js";

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
  readonly ast: ProgramNode;
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

    const module: ProjectModule = { path: item.path, ast: parsed.ast };
    modules.set(item.path, module);

    const importsByPath = new Map<string, ImportDeclarationNode>();
    const importsByAlias = new Map<string, ImportDeclarationNode>();
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
      pending.push({ path: resolved.path, requestedBy: { importerPath: item.path, declaration } });
    }
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
