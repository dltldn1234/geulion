import { lstatSync, realpathSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { posix } from "node:path";
import {
  parseSource,
  loadProjectSourceGraph,
  type ProjectSourceGraphResult,
} from "@geulion/compiler";

export interface FileProjectLoadFailure {
  readonly success: false;
  readonly message: string;
}

export interface FileProjectGraphFailure {
  readonly success: false;
  readonly diagnostics: Extract<
    ProjectSourceGraphResult,
    { readonly success: false }
  >["diagnostics"];
  readonly suppressedCount: number;
  readonly sources: ReadonlyMap<string, Uint8Array>;
}

export type FileProjectLoadResult =
  | Exclude<ProjectSourceGraphResult, { readonly success: false }>
  | FileProjectGraphFailure
  | FileProjectLoadFailure;

function canonicalRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.endsWith(".geul") &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function readWithoutLinks(root: string, relativePath: string): Buffer | undefined {
  let current = root;
  for (const part of relativePath.split("/")) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!entries.includes(part)) {
      if (
        entries.some(
          (entry) => entry.toLocaleLowerCase("en-US") === part.toLocaleLowerCase("en-US"),
        )
      )
        throw new Error(`경로 대소문자가 일치하지 않습니다: ${relativePath}`);
      return undefined;
    }
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new Error(`심볼릭 링크는 프로젝트에서 사용할 수 없습니다: ${relativePath}`);
  }
  const resolved = realpathSync(current);
  const fromRoot = relative(root, resolved);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    throw new Error(`프로젝트 root 밖의 파일은 읽을 수 없습니다: ${relativePath}`);
  return readFileSync(current);
}

/** Reads only the entry module's reachable, root-confined v0.4 source graph. */
export function loadProjectFiles(
  entryFile: string,
  projectRoot = dirname(resolve(entryFile)),
): FileProjectLoadResult {
  let root: string;
  let rootInput: string;
  let entry: string;
  try {
    rootInput = resolve(projectRoot);
    root = realpathSync(rootInput);
    entry = resolve(entryFile);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
  const entryRelativeNative = relative(rootInput, entry);
  if (
    entryRelativeNative === ".." ||
    entryRelativeNative.startsWith(`..${sep}`) ||
    isAbsolute(entryRelativeNative)
  )
    return { success: false, message: "진입 파일이 프로젝트 root 밖에 있습니다." };
  const entryPath = entryRelativeNative.split(sep).join("/");
  if (!canonicalRelativePath(entryPath))
    return { success: false, message: "진입 파일은 root 안의 .geul 파일이어야 합니다." };

  const sources = new Map<string, Uint8Array>();
  const pending = [entryPath];
  for (let index = 0; index < pending.length; index += 1) {
    const path = pending[index];
    if (path === undefined || sources.has(path)) continue;
    let source: Buffer;
    try {
      const fileSource = readWithoutLinks(root, path);
      if (fileSource === undefined) continue;
      source = fileSource;
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
    sources.set(path, source);
    const parsed = parseSource({ path, source });
    if (!parsed.success) continue;
    for (const declaration of parsed.ast.imports) {
      const importPath = declaration.path;
      if (
        (!importPath.startsWith("./") && !importPath.startsWith("../")) ||
        !importPath.endsWith(".geul") ||
        importPath.includes("\\") ||
        hasControlCharacter(importPath)
      )
        continue;
      const resolved = posix.normalize(posix.join(posix.dirname(path), importPath));
      if (canonicalRelativePath(resolved)) pending.push(resolved);
    }
  }

  const graph = loadProjectSourceGraph({
    entryPath,
    rootPath: root,
    sources,
    languageVersion: "0.4",
  });
  return graph.success ? graph : { ...graph, sources };
}
