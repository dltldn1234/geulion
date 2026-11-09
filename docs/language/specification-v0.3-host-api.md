# GEULION v0.3 Browser Module and Host API Specification

**Status: Normative contract.** This document specifies the source export marker, browser compilation target, invocation ABI, value transport, and save-envelope validation. Issues #45 and #47 implement public declarations, browser module generation, invocation validation, and browser CLI targets. Issue #49 adds a platform-neutral package that encodes and decodes the save envelope. Issue #51 adds a platform-neutral repository adapter over an injected byte-storage capability; the embedding application still owns the backend and its atomicity guarantees. The existing v0.1 and v0.2 contracts remain unchanged.

## 1. Version and target selection

- v0.1 remains the default language version. v0.3 includes the v0.2 language behavior and string prelude specified in `specification-v0.2.md`; selecting v0.2 and v0.1 continues to preserve their existing behavior.
- v0.3 is opt-in with `--language-version 0.3`. It is required for `공개 함수` declarations and the browser module target.
- The compiler API accepts `languageVersion: "0.3"` with `target: "browser"` for generated browser modules. The Node target accepts only v0.1 and v0.2.
- The CLI accepts `--target browser` on `emit-js` and `build`; both require `--language-version 0.3`. Conversely, v0.3 `emit-js` and `build` require the explicit browser target. `run` accepts only v0.1/v0.2 and remains Node-only. Omitting `--target` for v0.1/v0.2 preserves current Node output and behavior.
- `check` accepts `--language-version 0.3` without a target because it does not emit or execute a target artifact. `tokens` and `parse` remain version-neutral.
- Browser `emit-js` writes the module source to stdout. Browser `build` writes `<source-basename>.mjs` in the selected output directory, matching the current Node artifact naming. Generated source maps remain attached to the module as they are for current output. Neither command imports, loads, or runs the result.
- A browser module must declare at least one public function; an empty export set is a compilation error.
- `--target browser` is accepted only on `emit-js` and `build`; `run`, `check`, `tokens`, and `parse` reject it as an unknown/unsupported option. The CLI accepts only one target option and the value `browser`; Node remains the implicit target for v0.1/v0.2 code generation.
- A requested version/target pair that the CLI does not support is a usage error (exit status 2). It must fail before writing an artifact.

The compiler API's `compileSource` input is a discriminated target/version pair:

```ts
interface SourceInput {
  readonly path: string;
  readonly source: Uint8Array;
}

type NodeCompileInput = SourceInput & {
  readonly target?: "node";
  readonly languageVersion?: "0.1" | "0.2";
};

type BrowserCompileInput = SourceInput & {
  readonly target: "browser";
  readonly languageVersion: "0.3";
};

interface GeneratedSourceMapping {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly source: SourceSpan;
}

interface JavaScriptSourceMap {
  readonly version: 3;
  readonly file: string;
  readonly sources: readonly string[];
  readonly sourcesContent: readonly (string | null)[];
  readonly names: readonly string[];
  readonly mappings: string;
}

interface CompilationFailure {
  readonly success: false;
  readonly diagnostics: readonly Diagnostic[];
  readonly suppressedCount: number;
}

type CompilationResult =
  | {
      readonly success: true;
      readonly code: string;
      readonly sourceMap: JavaScriptSourceMap;
      readonly mappings: readonly GeneratedSourceMapping[];
      readonly diagnostics: readonly [];
      readonly suppressedCount: 0;
    }
  | CompilationFailure;

declare function compileSource(input: NodeCompileInput | BrowserCompileInput): CompilationResult;
```

`checkSource` accepts all three language versions and remains target-neutral. Callers must not cast an unsupported pair into `compileSource`.

## 2. Source exports and entry function

The v0.3 declaration form is `공개 함수 이름(매개변수: 타입, ...) -> 반환타입 { ... }`. It has the same body and static type rules as `함수`.

- `공개` is permitted only immediately before `함수`, and only with language version 0.3.
- `공개` remains an identifier token, not a new reserved word. The parser recognizes it as a modifier only immediately before a top-level `함수` declaration. Tokenization and parsing remain version-neutral; semantic checking rejects a public declaration unless version 0.3 is selected. Existing v0.1/v0.2 uses of `공개` as an identifier therefore remain valid.
- A public function exposes its normalized GEULION name and declared static signature. Private `함수` declarations remain callable inside the source program but are never listed or invocable by the host.
- Duplicate declarations and type errors use the existing name-resolution and type-checking diagnostics and rules. Export names are unique after the language's identifier normalization.
- A v0.3 program continues to require exactly one `함수 시작() -> 없음`. It is private unless explicitly exported; exporting `시작` is invalid. Browser modules never invoke `시작` automatically.
- Public functions may call private or public functions. Function values, callbacks, imports, and dynamic code generation are not introduced.
- Export metadata is ordered by declaration order in the source. It includes each parameter type and the return type recursively, with no inferred or erased signature.

## 3. Browser module and invocation ABI

The generated ES module exports `createModule(host)`. Importing it has no GEULION execution, output, browser-global access, event subscription, or persistence side effect.

```ts
interface RuntimeHost {
  write(text: string): void;
}

type GeulionType =
  | { readonly kind: "primitive"; readonly name: "없음" | "정수" | "실수" | "문자열" | "불리언" }
  | {
      readonly kind: "collection";
      readonly name: "목록" | "사전" | "선택";
      readonly element: GeulionType;
    };

type GeulionValue =
  | { readonly kind: "unit" }
  | { readonly kind: "integer"; readonly decimal: string }
  | { readonly kind: "real"; readonly value: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "none" }
  | { readonly kind: "some"; readonly value: GeulionValue }
  | { readonly kind: "list"; readonly values: readonly GeulionValue[] }
  | {
      readonly kind: "dictionary";
      readonly entries: readonly (readonly [string, GeulionValue])[];
    };

interface Diagnostic {
  readonly code:
    | "GE0001"
    | "GE0002"
    | "GE0003"
    | "GE1001"
    | "GE1002"
    | "GE2001"
    | "GE2002"
    | "GE2003"
    | "GE2004"
    | "GE2005"
    | "GE3001"
    | "GE3002"
    | "GE3003"
    | "GE3004"
    | "GE3005"
    | "GE3006"
    | "GE3007"
    | "GE3008"
    | "GE4001"
    | "GE4002"
    | "GE4003"
    | "GE4004"
    | "GE9001";
  readonly phase: "lex" | "parse" | "resolve" | "type" | "runtime" | "internal";
  readonly severity: "error";
  readonly message: string;
  readonly path: string | null;
  readonly range: SourceSpan | null;
  readonly help: string | null;
  readonly related: readonly RelatedDiagnosticInformation[];
}

interface SourcePosition {
  readonly byteOffset: number;
  readonly codePointOffset: number;
  readonly utf16Offset: number;
  readonly line: number;
  readonly column: number;
}

interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

interface RelatedDiagnosticInformation {
  readonly message: string;
  readonly path: string | null;
  readonly range: SourceSpan | null;
}

interface ExportSignature {
  readonly name: string;
  readonly parameters: readonly GeulionType[];
  readonly returns: GeulionType;
}

interface ProgramModule {
  readonly apiVersion: 1;
  readonly exports: readonly ExportSignature[];
  invoke(name: string, arguments_: readonly GeulionValue[]): InvokeResult;
}

type InvokeResult =
  | { readonly kind: "value"; readonly value: GeulionValue }
  | { readonly kind: "diagnostic"; readonly diagnostic: Diagnostic }
  | { readonly kind: "host-error"; readonly error: HostError };

type HostError =
  | { readonly code: "invalid-host" }
  | { readonly code: "unknown-export"; readonly name: string }
  | { readonly code: "argument-mismatch"; readonly name: string }
  | { readonly code: "internal-error" };

type CreateModuleResult =
  | { readonly kind: "module"; readonly module: ProgramModule }
  | { readonly kind: "host-error"; readonly error: { readonly code: "invalid-host" } };

declare function createModule(host: RuntimeHost): CreateModuleResult;
```

These TypeScript shapes define the JavaScript embedding ABI; they do not define GEULION source-level record types. `createModule` returns `invalid-host` unless `host` is a non-null object with a callable `write` property. It does not retain other properties from the supplied object.

For `invoke(name, arguments_)`:

1. An absent or non-public export returns `unknown-export`; the source program is not evaluated.
2. A non-array argument list, wrong arity, malformed value, or value not recursively matching the published parameter type returns `argument-mismatch`; the source program is not evaluated.
3. A valid call evaluates exactly the named public function and returns its result as a tagged value. It does not call `시작` unless a future contract explicitly says so; this v0.3 contract forbids exporting `시작`.
4. A GEULION runtime failure returns its existing structured diagnostic and stops that invocation. No new GEULION diagnostic code is introduced by the host API.
5. If `출력` calls `host.write` and that callback throws, invocation returns the existing `GE4004` runtime diagnostic. It does not return a successful value.
6. An unexpected failure internal to generated module code returns `internal-error`. Expected source or argument failures must not escape as untyped JavaScript exceptions.

Diagnostics are returned to the embedding application, which decides how to display or log them. The compiler module does not call a second diagnostic-report callback. Browser modules do not receive `window`, `document`, `process`, DOM objects, event objects, arbitrary host functions, or storage handles.

## 4. Tagged values and validation limits

The value tags are `unit`, `integer`, `real`, `string`, `boolean`, `none`, `some`, `list`, and `dictionary`, with the shapes shown in the v0.3 proposal. The public signature is authoritative, and validation occurs before evaluation and on a returned value.

- `unit` represents `없음`; `none` and `some(value)` represent `선택[T]` and remain distinct from unit.
- `integer.decimal` is the canonical base-10 spelling of a signed 64-bit integer, from `-9223372036854775808` through `9223372036854775807`. It has no leading plus, no leading zero except `0`, and negative zero is spelled `0`.
- A finite `real.value` is the exact result of ECMAScript `Number.prototype.toString()` for that value. The only special spellings are `NaN`, `Infinity`, `-Infinity`, and `-0`. A parser must round-trip the spelling to the same IEEE-754 value; other spellings are invalid.
- Strings and dictionary keys are Unicode scalar sequences. Lone UTF-16 surrogates are invalid. No normalization, case folding, or locale transformation occurs at the ABI.
- A dictionary is an array of `[key, value]` pairs with unique string keys. Entry ordering is not observable. Save serialization sorts keys lexicographically by their Unicode scalar-value sequences to provide stable bytes.
- Unknown tags, missing or extra fields, duplicate dictionary keys, invalid numbers, type mismatches, cycles, and non-JSON host objects are invalid values.
- The maximum encoded value size is 1 MiB of compact UTF-8 JSON. Maximum nesting depth is 64 (the root has depth 0), maximum value nodes are 65,536, maximum list or dictionary entries are 16,384, and maximum individual string or key size is 262,144 UTF-8 bytes. Exceeding any limit invalidates the whole crossing; partial values are never accepted.
- The size and node limits apply before GEULION evaluation and to the result after evaluation. Implementations must reject before unbounded recursive traversal or allocation.

## 5. Save envelope and compatibility

Persistence remains owned by the embedding application. GEULION code and the generated module do not read, write, or select storage. A stored save is compact UTF-8 JSON with exactly these fields:

```ts
interface SaveEnvelopeV1 {
  readonly format: "geulion-save";
  readonly envelopeVersion: 1;
  readonly languageVersion: "0.3";
  readonly applicationVersion: string;
  readonly value: GeulionValue;
}
```

- `applicationVersion` is 1–64 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._+-]{0,63}`. Applications may use a release number or a stable save-schema version.
- The full encoded envelope is limited to 1 MiB of compact UTF-8 JSON and inherits the value depth, node, string, and collection limits.
- An absent storage key means no save. It is not an encoded `none` value.
- Wrong format, unsupported envelope version, unsupported language version, invalid field shape, invalid value, invalid UTF-8, or size-limit violation is a persistence error. It must not be converted to an empty/default save or a GEULION diagnostic.
- An `applicationVersion` mismatch is incompatible. Only an explicit application migration may transform it to the current version; the compiler supplies no implicit migration or coercion.
- A failed save operation leaves the application's prior persisted value intact when the host storage supports atomic replacement. The application keeps its last in-memory state and surfaces the storage failure separately from GEULION diagnostics.
- Save parsing and migration happen in the adapter before invoking GEULION. The same envelope rules apply in browser and Node adapters.

The `@geulion/host-api` package exports `createSaveRepository(storage, key, applicationVersion)`. It serializes `load`, `save`, and `transact` operations for one repository instance. `load` distinguishes an absent key from a stored `none`; malformed or incompatible bytes return `codec-error` and are left untouched. Storage exceptions return `storage-error`. Invalid adapter arguments return `adapter-error`, while an invalid application version returns the codec's `invalid-application-version`. `transact` lazily loads the current value, passes an isolated snapshot (or `null` when absent) to the updater, and updates its in-memory snapshot only after the backend write resolves successfully. It does not migrate old saves or provide cross-instance locking.

An embedding application supplies its own storage implementation and checks each result:

```ts
const saves = createSaveRepository(storage, "idle-save", "1.0.0");
const loaded = await saves.load();
if (
  loaded.kind === "codec-error" ||
  loaded.kind === "storage-error" ||
  loaded.kind === "adapter-error"
) {
  // Keep the existing bytes; let the application report or recover explicitly.
} else if (loaded.kind === "absent") {
  // Start a new game without conflating it with a stored GEULION `none`.
} else {
  const next = await saves.transact((current) => updateGame(current));
  if (next.kind !== "saved") {
    // Keep the last in-memory state and surface the failure to the application.
  }
}
```

The repository can report success only after `storage.write` resolves. If a backend mutates data and then rejects, rollback is backend-specific; hosts that need prior persisted bytes preserved on failure must implement atomic replacement. Multiple repository instances sharing one key also require backend-level coordination.

The existing Node `run` command and Node build remain process-entry execution for v0.1/v0.2. They do not expose `createModule`. A future programmatic Node adapter for v0.3 must implement the same `createModule` ABI, input/result validation, and observable invocation behavior as the browser adapter; it may provide platform-specific persistence, but persistence still follows this envelope contract. This specification does not require the current Node CLI runtime to add v0.3 support.

## 6. Conformance requirements

Before an implementation is declared conforming, executable cases must cover:

- v0.1 default and v0.2 behavior unchanged; v0.3 opt-in and invalid version/target combinations;
- valid public declarations, private visibility, normalized duplicate export names, invalid `공개` placement, and the required private `시작` function;
- inert module import, no automatic start call, declaration-order export metadata, public invocation, and rejection of private/unknown names;
- every primitive and recursive collection/option ABI value, exact boundary integers, special real values, Unicode scalar validation, and malformed/tag/type mismatch cases;
- every size/depth/node/collection limit at the boundary and one unit beyond it, including early rejection;
- each `InvokeResult` outcome, preserved `GE4004`, source diagnostic ranges, and failures of the supplied output callback;
- valid, absent, malformed, oversized, unsupported-version, incompatible-application-version, and explicitly migrated save envelopes;
- browser and programmatic Node v0.3 host adapters produce identical values and GEULION diagnostics for the same public invocation sequence.

The browser module, invocation ABI, save-envelope codec, and injected-storage repository adapter are implemented and covered by repository tests. The adapter does not select a storage backend, guarantee rollback/atomicity, coordinate separate repository instances, migrate versions, or integrate with an Idle UI. The full conformance list above still includes adapter parity and runtime checks outside this package.
