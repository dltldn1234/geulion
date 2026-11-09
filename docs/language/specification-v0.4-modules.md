# GEULION Language Specification v0.4 — Modules

**Status: Specified.** This document defines the normative v0.4 project and module contract. It does not claim that any v0.4 compiler, CLI, source-map, or Language Server feature is implemented. Implementation status is tracked separately in `README.md` and `../development/progress.md`.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, and **MAY** are normative requirements. “Module” means one UTF-8 `.geul` source file.

## 1. Version boundary and compatibility

- v0.4 is opt-in through `--language-version 0.4`; the default remains v0.1.
- A v0.4 project uses v0.4 for every source in the entry module's reachable import closure. The language version is selected once per project; source files MUST NOT select a different version independently.
- v0.1, v0.2, and v0.3 retain their existing single-source behavior. An import declaration is rejected under those versions. Existing single-source `checkSource` and `compileSource` calls keep their existing contracts.
- A project API MUST receive an explicit entry path, project root, version, and finite source provider or source map. Compiler APIs MUST NOT read files implicitly. Filesystem access belongs to the CLI or an embedding host.
- Tokenization remains version-neutral. `가져오기` is contextual syntax only at the start of a top-level module declaration; elsewhere it retains the existing identifier behavior where the grammar permits an identifier.

## 2. Module form and grammar

A module consists of zero or more imports followed by function declarations. Imports MUST precede all function declarations. Empty modules are valid only when imported; the Node entry module has the entrypoint requirement in §6.

```geulion
가져오기 "./수학.geul" 별칭 수학

공개 함수 결과(값: 정수) -> 정수 {
  반환 수학.더하기(값, 1)
}

함수 시작() -> 없음 {
  출력(결과(4))
}
```

The normative productions below extend the v0.1 grammar. `식별자`, `문자열`, `함수선언`, and `매개변수목록` retain their existing lexical and syntactic definitions. `호출표현식` is the existing call expression with the callee forms shown here.

```ebnf
모듈             ::= 구분자* 가져오기선언 (구분자* 가져오기선언)*
                     (구분자* 함수선언 (구분자* 함수선언)*)? 구분자* EOF
가져오기선언    ::= "가져오기" 문자열 "별칭" 식별자
한정호출표현식 ::= 식별자 "." 식별자 "(" 인자목록? ")"
```

`함수선언`, `구분자`, `식별자`, `문자열`, `인자목록`, `EOF`는 `grammar.ebnf`의 정의를 따릅니다. 기존 `호출표현식`에 `한정호출표현식`을 추가하는 것 외에 v0.1 문법의 함수/문장/표현식 규칙은 유지됩니다.

Qualified calls permit exactly one namespace alias and one exported function name. Chained qualification, arbitrary member access, first-class module values, named imports, wildcard imports, and re-exports are invalid in v0.4. `별칭` is contextual in an import declaration. Each import path and alias is a single string and identifier respectively.

**Valid:**

```geulion
가져오기 "../공통/수학.geul" 별칭 수학
함수 시작() -> 없음 { 출력(수학.더하기(1, 2)) }
```

**Invalid (import after a function):**

```geulion
함수 시작() -> 없음 { }
가져오기 "./수학.geul" 별칭 수학
```

**Invalid (chained namespace):** `수학.고급.더하기(1, 2)`

## 3. Import identity and path resolution

- Import paths MUST be quoted relative paths beginning with `./` or `../` and MUST end in the exact `.geul` extension. Absolute paths, drive paths, URL schemes, package names, environment expansion, globbing, and implicit extension lookup are invalid.
- A path is resolved relative to the importing module's directory, then canonicalized relative to the explicit project root. The project root is an absolute host path at the API boundary; source-map and diagnostic paths are normalized project-relative paths using `/`.
- Canonicalization removes `.` components and resolves `..` components lexically. The resulting path MUST remain beneath the root; equality with the root itself is not a module path. Root escape is an error even if the file exists.
- v0.4 forbids symlink traversal in any component from the root to an imported source. A host that supplies a virtual source map MUST apply the same path identity rules to its keys.
- Path component spelling is case-sensitive. A file differing only by case MUST NOT be selected as a fallback. Implementations on case-insensitive filesystems MUST diagnose a spelling mismatch rather than silently bind it.
- Module identity is its canonical project-relative path. Repeated imports that canonicalize to the same path refer to the same module. The same module path MUST NOT appear more than once in one module's import list, including aliases to the same target.
- Only the transitive import closure of the entry is loaded or compiled. Unreferenced source files are ignored. Missing or unreadable reachable sources are diagnostics.

An import's alias MUST be unique within the importing module and MUST NOT collide after NFC normalization with a local function name, another alias, or a prelude name available as an unqualified function. Imported modules expose only public function declarations.

## 4. Visibility and name resolution

- `공개 함수` is the only cross-module API. A module namespace contains its public functions and no other members. Private functions are callable only within their declaring module.
- Identifier equality and duplicate detection use the NFC normalization rules in the lexical specification. Exported names and alias member names use that same equality. Overloading is unsupported.
- Project analysis MUST first load and parse the complete reachable graph, collect every module's local function signatures and imports, and then resolve function bodies. This permits function-only cycles without order-dependent lookup.
- An unqualified call resolves to a function in the current module or the existing prelude. It MUST NOT search other project modules by basename or function name. A qualified call resolves only through the declared alias in that source module.
- Unknown aliases, unknown exports, references to private functions, duplicate declarations, and type mismatches are errors. The diagnostic points to the use and SHOULD include the declaration or import as a related location when available.
- The entry module's `공개 함수` remain browser host exports as defined by v0.3. In a v0.4 project they are also eligible for imports from other modules. The entry function `시작` is never an importable export.

## 5. Project API, CLI, and artifacts

A project compiler MUST expose an API alongside the current single-source API. Its input MUST provide an entry path, root path, finite source map/provider, version `"0.4"`, and optional target `"node" | "browser"`. The API MUST remain deterministic for the same source bytes, canonical paths, options, and compiler version. The exact exported type names follow the compiler package's API conventions.

The CLI project forms are:

```text
geulion check <entry.geul> --language-version 0.4 [--root <directory>]
geulion emit-js <entry.geul> --language-version 0.4 [--target browser] [--root <directory>]
geulion run <entry.geul> --language-version 0.4 [--root <directory>]
geulion build <entry.geul> --language-version 0.4 [--target browser] [--root <directory>]
```

When omitted, `--root` is the entry file's containing directory. Every command MUST use the same project resolution and diagnostics. Unsupported version/target/command combinations are usage errors and MUST fail before writing an artifact. `check` MUST NOT generate or execute code. Dependency discovery MUST NOT execute module code.

A successful project compilation produces one deterministic JavaScript artifact for all reachable modules. Generated internal names MUST avoid collisions across modules and with runtime helpers. Output ordering MUST derive from canonical module identity and declaration order, never filesystem enumeration order. The Node `run` command executes the entrypoint once after the entire graph parses, resolves, and type-checks; it MUST NOT partially execute a project that later fails compilation. Node `build` writes one standalone artifact.

Browser `emit-js` and `build` preserve the v0.3 `createModule(host)` ABI: the returned module is inert until a host-invoked public function runs; it MUST NOT invoke `시작` automatically. Only public functions declared by the entry module are exposed to the host. Imported modules' exports are internal to the generated artifact. Browser output retains the existing host capability boundary and MUST NOT introduce ambient DOM, process, filesystem, or arbitrary host access.

The project API MUST return source maps that identify each original module by canonical project-relative path and retain original source spans. Diagnostics from any phase MUST identify the source path and range. Generated mappings MUST remain stable for an unchanged project input.

## 6. Entry point, cycles, and initialization

- Node `run` and Node `build` require exactly one entry-module declaration `함수 시작() -> 없음`. It MUST be private. Imported modules MUST NOT declare `시작`.
- `check` validates a project as a runnable Node project and therefore applies the entrypoint rule. A future library-check mode requires a separate specification.
- Browser `emit-js` and `build` preserve the v0.3 requirement that the entry module declare at least one `공개 함수`. A private `시작` is permitted when it meets the normal v0.1 signature, but is never automatically invoked. Imported modules do not require `시작` and MUST NOT declare it.
- A module body contains imports and function declarations only. Top-level expressions, variables, initialization blocks, and module initialization side effects are forbidden.
- Direct and indirect import cycles are permitted. Implementations MUST discover the complete reachable graph before signature resolution and MUST report every source module identity consistently. Function recursion and mutual recursion across modules follow the existing function-call semantics.

**Valid cycle:** `a.geul` imports `b.geul`; `b.geul` imports `a.geul`; both modules contain only function declarations and calls.

**Invalid library entrypoint:** an imported module declares `함수 시작() -> 없음`.

## 7. Diagnostics

Project diagnostics extend the common diagnostic structure in `diagnostics.md`. Every source diagnostic MUST include a normalized project-relative `path`; related locations MUST also include their own module path. Failure to resolve a module points at the import path. Alias/member errors point at the relevant identifier.

The following codes are reserved for v0.4 module diagnostics and MUST NOT be reused for a different cause:

| Code     | Phase   | Cause                                                                                                                                   |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GE1003` | parse   | Import declaration is malformed, misplaced, or appears after a function declaration.                                                    |
| `GE2006` | resolve | Import path is invalid, has the wrong extension, is missing/unreadable, or has a case mismatch.                                         |
| `GE2007` | resolve | Canonical import path escapes the project root or traverses a symlink.                                                                  |
| `GE2008` | resolve | Duplicate module import, duplicate alias, or alias collision with a declaration or prelude name.                                        |
| `GE2009` | resolve | Qualified call uses an unknown alias, unknown export, or private function.                                                              |
| `GE2010` | resolve | A non-entry module declares the reserved `시작` function, or the entrypoint is missing, duplicated, public, or has the wrong signature. |
| `GE2011` | resolve | An import declaration is used while the selected language version is v0.1–v0.3.                                                         |

A malformed quote or invalid source encoding continues to use the existing lexical diagnostic. Ordinary invalid token ordering outside import placement continues to use the existing parser diagnostics. A type mismatch in a qualified call uses the existing type diagnostic.

## 8. Language Server requirements

The Language Server MUST use the compiler's canonical module identity and export resolution for diagnostics, definition, references, rename, hover, completion, and signature help. It MUST NOT infer compiler bindings from workspace-wide basename or unique-name searches. Only explicit reachable imports establish cross-file references.

Open buffers override disk contents for their canonical path. Changes to a module MUST invalidate analysis and diagnostics for every dependent module in the reachable graph, including dependents reached through cycles. Results from an outdated document version MUST NOT replace newer diagnostics. Returned locations use each target source's URI and negotiated LSP position encoding.

A workspace may contain multiple independent v0.4 entry projects. The server MUST keep their roots and module identities separate, reject import escapes at each project's root, and avoid loading unrelated workspace files.

## 9. Conformance requirements

A conforming v0.4 implementation MUST cover at least these cases before claiming implementation complete:

- sibling and nested relative imports, explicit aliases, qualified calls, public and private functions;
- NFC-equivalent aliases/exports, duplicate paths, alias/local/prelude collisions, and same basenames in different directories;
- missing files, invalid extension, root escape, symlink traversal, case mismatch, and unreferenced files;
- direct and indirect cycles, recursion, mutual recursion, and function signatures collected before bodies;
- entrypoint rules independently for Node and browser targets, including no automatic browser invocation;
- v0.1–v0.3 behavior unchanged and rejection of imports under those versions;
- multi-source diagnostics, related locations, source-map paths/spans, and deterministic output under different enumeration orders;
- LSP behavior with explicit imports, independent roots, unsaved imported buffers, dependent invalidation, and UTF-8/16/32 position encoding.

## 10. Scope exclusions

Packages, registries, dependency versioning, dynamic imports, named imports, re-exports, module values, top-level state/initialization, arbitrary host imports, and library-only entry modes are outside v0.4. Any such feature requires a later versioned specification.
