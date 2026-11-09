# GEULION Module System Proposal

**Status: Proposed RFC** — this document proposes a versioned multi-file module model. It does not change the v0.1, v0.2, or v0.3 language contracts and does not claim that modules are implemented.

## 1. Context and goals

GEULION currently treats one `.geul` file as one program. That program must declare exactly one `함수 시작() -> 없음`; function declarations can call other functions in the same file. The v0.3 browser target generates a host-facing module from one source file, and `공개 함수` describes that source's host exports. Neither contract defines imports between GEULION files.

This proposal adds a project made of statically connected source modules while retaining the existing single-file contracts. It aims to:

- make dependencies explicit in source and resolve them without runtime name guessing;
- preserve static typing, NFC identifier equality, and declaration-before-body resolution;
- keep module loading free of top-level execution and implicit I/O;
- let the CLI and language server use the same dependency graph and symbol identities;
- keep generated output deterministic and avoid a runtime module loader.

It does not add package registries, dynamic imports, function values, top-level mutable state, re-exports, or arbitrary host imports.

## 2. Version boundary

Modules are proposed for language version **0.4**, selected explicitly with `--language-version 0.4`. The default remains 0.1. Existing v0.1–v0.3 source keeps its present single-file meaning. A v0.1–v0.3 source containing an import is rejected; a v0.4 project uses one language version for every reachable source file.

The existing `checkSource` and `compileSource` APIs remain single-source APIs. A project-aware API must receive a finite source map or source-provider callback and an explicit entry path; it must not read arbitrary files behind the caller's back. CLI filesystem access remains in the CLI layer.

## 3. Proposed source form

Use a contextual top-level declaration and a module namespace alias:

```geulion
가져오기 "./수학.geul" 별칭 수학

함수 시작() -> 없음 {
  출력(수학.더하기(2, 3))
}
```

The imported file declares its API explicitly:

```geulion
공개 함수 더하기(왼쪽: 정수, 오른쪽: 정수) -> 정수 {
  반환 왼쪽 + 오른쪽
}
```

This is a syntax proposal, not a finalized grammar. `가져오기` should be recognized only in the top-level import position, as `공개` is currently recognized contextually before a function. The parser would add a qualified-call form for `수학.더하기(...)`. A namespace import avoids collisions between unrelated imported functions and makes the dependency visible at each call site. Named imports and re-exports are deferred until a demonstrated need exists.

Imports must precede function declarations. A module may import the same normalized module path once; duplicate aliases, alias collisions with local functions or values, and missing aliases are errors. A module cannot import a private function. Imported calls are statically bound and type checked from the export signature.

## 4. Module identity and path resolution

- A module is one UTF-8 `.geul` source file. Its identity is its canonical project-relative path, not its basename or a declared module name.
- Import paths are quoted relative paths beginning with `./` or `../`. Absolute paths, URL schemes, package names, environment-variable expansion, and implicit extension lookup are excluded from v0.4.
- The `.geul` extension is required. Resolution is relative to the importing file, then canonicalized before graph traversal so two spellings of the same file do not compile it twice.
- A project root is explicit for project APIs. CLI commands default it to the entry file's containing directory and may accept `--root` to permit a larger project layout. Every resolved import must remain inside that root after canonicalization; symlink traversal is rejected in v0.4.
- Path matching is case-sensitive in the language contract. Implementations must diagnose casing mismatches consistently rather than silently selecting a different file on a case-insensitive filesystem.
- The compiler reads only the entry module's reachable import closure. Unreferenced `.geul` files in the project are not implicitly compiled.

These rules make a build reproducible from a declared entry file and source tree and give LSP workspace roots a clear boundary. Package management and standard-library discovery remain separate future work.

## 5. Exports and name resolution

`공개 함수` is the only cross-module API in v0.4. A module namespace exposes only public functions. Private functions remain available to other functions in the same module and are not addressable through an import alias. The normalized name and declared parameter/return types form the exported signature. Overloading remains unsupported.

Each module resolves local declarations and imports in two passes: collect all local function signatures and import aliases, then type-check bodies. Calls such as `수학.더하기(...)` resolve only through that alias. An unqualified call continues to resolve to a local function or prelude function; it never searches other project files by name. Two aliases may refer to the same module, but each alias is distinct and explicit.

`공개 함수` retains the v0.3 browser-host export meaning for the entry module. In a v0.4 Node project, public functions are available to importing GEULION modules; the entry module's `시작` is not callable by an imported module. The browser target continues to expose only the entry module's public host API through `createModule(host)`.

## 6. Entry point, cycles, and initialization

For Node `run` and `build`, the entry module must contain exactly one private `함수 시작() -> 없음`. Imported modules do not need an entrypoint and may not declare one. The entry function runs once after the complete project has passed parsing, resolution, and type checking.

Modules contain only imports and function declarations. They have no top-level expressions, variables, or initialization blocks. Therefore importing a module has no GEULION side effect. **Recommendation:** permit cyclic imports in v0.4 because calls are linked statically and there is no module initialization order to observe. The resolver must build the complete graph before resolving exported signatures, and tests must cover direct and indirect cycles. This recommendation should be revisited before any top-level state is proposed.

For browser output, `createModule(host)` remains inert until a host-invoked public function runs; it never starts the entrypoint automatically. Whether the browser target requires a private `시작` in v0.4 should remain aligned with the current v0.3 host-module contract unless a separate browser-library mode is designed.

## 7. Compilation and output proposal

The project compiler performs deterministic graph loading, parsing, module-level name resolution, type checking, and code generation. All modules are compiled as one output artifact for v0.4. This avoids exposing generated module layout and keeps Node `run` temporary-file behavior simple. Generated source maps retain each original source path and span.

Suggested CLI behavior:

```text
geulion check <entry.geul> --language-version 0.4 [--root <directory>]
geulion emit-js <entry.geul> --language-version 0.4 [--target browser] [--root <directory>]
geulion run <entry.geul> --language-version 0.4 [--root <directory>]
geulion build <entry.geul> --language-version 0.4 [--target browser] [--root <directory>]
```

`run` and Node `build` require the entrypoint. Browser `emit-js`/`build` preserve the inert host ABI and entry-module public exports. `check` validates the same dependency graph without generating or executing code. No command may execute module code during dependency discovery.

The public compiler API should add a project-level input alongside, not in place of, the current single-source APIs. Proposed shape:

```ts
interface ProjectCompileInput {
  readonly entryPath: string;
  readonly rootPath: string;
  readonly sources: ReadonlyMap<string, Uint8Array>;
  readonly languageVersion: "0.4";
  readonly target?: "node" | "browser";
}
```

The exact API name and result type should follow existing compiler conventions when implementation begins. Missing imports must be reported as source diagnostics; the compiler API itself must not perform filesystem reads.

## 8. Diagnostics and editor behavior

Project diagnostics need a source path on every span and related location. In addition to existing parse, resolve, and type errors, implementation will need stable diagnostics for missing/invalid import paths, root escape, alias conflicts, private or unknown exports, and invalid entrypoint placement. Numeric diagnostic codes must be allocated from the repository's current registry during implementation; this proposal intentionally does not reserve codes.

The language server should resolve only imports declared by the active module and the transitive project graph. Definition, references, rename, hover, completion, and diagnostics should share the compiler's module/symbol identities. A same-named declaration elsewhere in the workspace is not a reference unless the source import graph binds it. Open buffers override disk contents, and edits to an imported module invalidate dependent analysis and diagnostics.

## 9. Conformance cases

The v0.4 acceptance suite should cover:

- one entry module importing a public function from a sibling file;
- multiple modules with the same basename in different directories;
- private/unknown export access and local/import alias collisions;
- normalized Unicode identifiers and duplicate export names;
- missing files, wrong extensions, root escapes, symlinks, and path-case mismatches;
- direct and indirect import cycles, recursion, and mutual recursion;
- no entrypoint in a library, exactly one valid entrypoint in the root, and forbidden library `시작`;
- source-map locations and diagnostics in imported files;
- deterministic output under different filesystem enumeration orders;
- v0.1–v0.3 compatibility and rejection of imports before v0.4;
- LSP definition/references/rename through an explicit import, including unsaved imported buffers.

## 10. Implementation sequence

1. Resolve the open syntax and path-policy questions below and promote this RFC to a versioned v0.4 specification.
2. Add contextual import syntax, qualified-call AST nodes, and parser diagnostics.
3. Add pure project graph input/loading boundaries and stable module identities.
4. Add export collection and cross-module type/name resolution without changing single-source APIs.
5. Add project code generation, source-map composition, CLI project options, and runtime/build coverage.
6. Integrate graph-aware Language Server providers and invalidation.
7. Add executable conformance fixtures and documentation examples before marking v0.4 implemented.

## 11. Decisions to confirm before normative specification

| Question           | Recommendation                                       | Why                                                                                                     |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Import syntax      | Namespace import with explicit alias                 | Avoids global imported-name collisions and makes call origins visible.                                  |
| Import path root   | Explicit project root, defaulting to entry directory | Allows sibling projects while preventing imports outside the selected tree.                             |
| Cycles             | Allow function-only cycles                           | There is no top-level execution or mutable module state; all signatures can be collected before bodies. |
| Output             | Deterministic single-file bundle                     | Keeps build/run artifacts and source maps manageable while the module system is new.                    |
| Versioning         | Opt-in v0.4; preserve v0.1–v0.3 unchanged            | Prevents import syntax or entrypoint changes from silently changing existing programs.                  |
| Browser entrypoint | Preserve current host ABI; no automatic `시작`       | Maintains the v0.3 host execution boundary.                                                             |

These recommendations are not yet normative. Any change to public syntax, CLI invocation, or browser entrypoint behavior requires an explicit decision before the document is promoted to a language specification.
