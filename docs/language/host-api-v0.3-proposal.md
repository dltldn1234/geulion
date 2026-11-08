# GEULION v0.3 Host and Application Boundary Proposal

**Status: Superseded as a decision source.** This document records the initial design exploration. The v0.3 browser-module, export, ABI, value-validation, and save-envelope decisions are now specified in [specification-v0.3-host-api.md](specification-v0.3-host-api.md). That document is a normative design target, not evidence that the features are implemented.

## Goals and boundaries

The first host-supported application should let a JavaScript browser adapter:

- invoke explicitly exposed GEULION functions with checked GEULION values;
- pass user events and elapsed time into GEULION code as ordinary values;
- retain and restore application state through an adapter-owned persistence interface;
- route GEULION output and diagnostics to an embedding application.

GEULION code must not receive `window`, `document`, `process`, filesystem handles, arbitrary JavaScript objects, or a generic host-function dispatcher. A host capability is available only when an embedding adapter explicitly supplies it. The recommended initial boundary keeps clocks, event listeners, and storage in the adapter and passes their observations into GEULION functions. This keeps the state transition deterministic for a given argument tuple.

This proposal is narrower than general FFI or a module/package system. It does not define asynchronous GEULION functions, callbacks, concurrency, network access, filesystem access, random number generation, wall-clock access, or offline progress.

## Existing implementation constraints

The current language accepts one `.geul` program with exactly one `함수 시작() -> 없음`. It has no import/export syntax, function values, user-defined record types, or mutable collections. Functions have statically checked signatures and may call each other by name. Lists, dictionaries, and option values use value semantics.

The current JavaScript generator emits a Node.js module that imports `node:fs`, writes output to file descriptors, invokes `시작` during module evaluation, and places source diagnostics in the generated file. The compiler currently exposes only the `node` target. The v0.3 proposal therefore requires an explicit browser-module target and an export boundary; the current generated artifact cannot be loaded directly in a browser.

## Recommended source and invocation model

For a future v0.3 increment, add an explicit `공개 함수` declaration marker for functions that an embedding program may invoke. Ordinary `함수` declarations remain private to the GEULION program. The compiler must type-check each public function using the existing function rules and publish its exact parameter and return types as module metadata. The host may invoke only those public functions; it cannot address private functions or synthesize new code.

The browser-module compilation target should produce an inert ES module. Importing the module must not run GEULION code or subscribe to browser events. The module should expose a small factory that receives only the runtime host callbacks (output and diagnostic reporting) and returns the public function metadata plus an `invoke(name, arguments)` operation. The CLI `run` and `build` targets retain their current Node.js behavior.

Illustrative future source surface (proposal only):

```geul
공개 함수 새 게임() -> 목록[정수] {
    반환 [0, 0, 0]
}

공개 함수 입력 반영(상태: 목록[정수], 동작: 문자열, 경과 밀리초: 정수) -> 목록[정수] {
    // Pure state transition; actual game rules are specified by the application.
    반환 상태
}

함수 내부 계산(값: 정수) -> 정수 {
    반환 값
}
```

The names and syntax in this historical example were illustrative when first proposed. The normative spelling and browser-target behavior are now defined in [specification-v0.3-host-api.md](specification-v0.3-host-api.md).

The proposed module surface is:

```ts
type GeulionType =
  | { readonly kind: "primitive"; readonly name: "없음" | "정수" | "실수" | "문자열" | "불리언" }
  | {
      readonly kind: "collection";
      readonly name: "목록" | "사전" | "선택";
      readonly element: GeulionType;
    };

interface ExportSignature {
  readonly name: string;
  readonly parameters: readonly GeulionType[];
  readonly returns: GeulionType;
}

interface RuntimeCallbacks {
  write(text: string): void;
  report(diagnostic: Diagnostic): void;
}

interface ProgramModule {
  readonly exports: readonly ExportSignature[];
  invoke(name: string, arguments: readonly GeulionValue[]): InvokeResult;
}

declare function createModule(host: RuntimeCallbacks): ProgramModule;
```

These TypeScript declarations were an initial ABI sketch. The normative JavaScript embedding ABI is defined in [specification-v0.3-host-api.md](specification-v0.3-host-api.md). Neither document adds function values or user-defined type declarations to GEULION source.

## Value transport

The embedding ABI should transport only the following tagged values. Each public function's declared signature is authoritative; an argument with a different tag or nested type is rejected before GEULION code runs.

```ts
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
```

- `integer.decimal` is a base-10 signed integer spelling in the GEULION signed 64-bit range. It avoids JavaScript `Number` precision loss.
- `real.value` uses the shortest round-tripping ECMAScript number spelling. The reserved strings `NaN`, `Infinity`, `-Infinity`, and `-0` preserve the values JSON numbers cannot represent faithfully.
- Strings are exact Unicode scalar sequences; no normalization or locale conversion occurs at the boundary.
- A dictionary's keys are strings and duplicate keys are invalid. Entry order is not semantically observable.
- `unit`, `none`, and `some` remain distinct variants. Lists, dictionaries, and options are recursively encoded.
- The wire shape is a transport representation, not a new GEULION source type. The adapter must validate the complete value tree and the declared function signature on every crossing.

Persistence should store an envelope such as `{ format: "geulion-save", envelopeVersion: 1, languageVersion: "0.3", applicationVersion: "1", value: ... }`, where `value` is one `GeulionValue`. A missing key means no saved value. An unsupported envelope version, malformed value, or incompatible application save version is a host persistence error; it must not be coerced into `비어있음` or a GEULION runtime diagnostic.

## Host adapter contract

The application host, not the GEULION module, owns platform APIs. The interface below records the initial conceptual design; normative browser module boundaries and failure results are defined in [specification-v0.3-host-api.md](specification-v0.3-host-api.md).

```ts
interface IdleHost {
  readonly clock: { nowMonotonicMilliseconds(): number };
  readonly events: {
    subscribe(listener: (event: HostEvent) => void): () => void;
  };
  readonly storage: {
    load(key: string): Promise<GeulionValue | undefined>;
    save(key: string, value: GeulionValue): Promise<void>;
    remove(key: string): Promise<void>;
  };
}

type HostEvent =
  | { readonly kind: "action"; readonly name: string }
  | { readonly kind: "elapsed"; readonly milliseconds: number };
```

The adapter maps DOM events to the closed `HostEvent` union and maps GEULION public-function arguments according to their published signatures. It must not pass DOM nodes, event objects, storage objects, or callbacks through `GeulionValue`. It samples a monotonic clock and supplies a non-negative, safe integer elapsed duration in milliseconds to an update call. Wall-clock timestamps and time while the application is closed are separate future capabilities and are excluded here.

Storage is asynchronous at the adapter boundary so browser implementations may use IndexedDB. GEULION invocation remains synchronous in this proposal: the adapter awaits load before initialization and awaits save after each successful state transition. It serializes updates so two events cannot update the same old state concurrently. Persistence failures are reported by the embedding application and do not silently discard the last in-memory state.

The host implementation must be explicit for each target. A browser implementation may use browser APIs behind this interface; a Node implementation may use Node APIs behind an equivalent interface. A target that lacks a supplied capability fails during host setup with a host error. The language itself does not discover or grant capabilities implicitly.

## Invocation, results, and errors

The proposed `invoke(name, arguments)` result is a tagged union:

```ts
type InvokeResult =
  | { readonly kind: "value"; readonly value: GeulionValue }
  | { readonly kind: "diagnostic"; readonly diagnostic: Diagnostic }
  | { readonly kind: "unknown-export"; readonly name: string }
  | { readonly kind: "argument-mismatch"; readonly name: string }
  | { readonly kind: "host-failure"; readonly operation: string };
```

The operation has these observable outcomes:

1. If `name` is not a published export, return a host-level `unknown-export` error and run no GEULION code.
2. If the arity or any recursively checked value does not match the published signature, return a host-level `argument-mismatch` error and run no GEULION code.
3. If arguments are valid and GEULION completes, return its `GeulionValue` result.
4. If GEULION runtime evaluation fails, return the existing structured GEULION diagnostic, including its source path and range when available. Stop that invocation; do not convert it to a successful value.
5. If the diagnostic-reporting callback itself fails, return a separate `host-failure`. Do not fabricate a language diagnostic for an adapter failure. If the GEULION `출력` operation cannot write through the supplied output callback, preserve its existing `GE4004` runtime diagnostic.

The module must not throw an untyped exception for expected validation or GEULION runtime failures. Unexpected implementation faults may be reported as an internal host failure; they must not be disguised as a user source error. This proposal does not allocate new GEULION diagnostic codes. A later implementation issue must map these categories to concrete public TypeScript types and conformance tests.

## Compatibility and version selection

- v0.1 remains unchanged and remains the default.
- v0.2 remains unchanged and continues to add only the four specified pure string functions.
- Host-module behavior is opt-in under a proposed language version 0.3 and a proposed explicit browser-module compilation target. The exact flag/API is to be decided before implementation.
- Existing `tokens`, `parse`, `check`, `emit-js`, `run`, and Node `build` behavior must not silently change.
- Browser output must not import Node built-ins, access ambient browser globals, or auto-start on import.
- The public export metadata and all host crossings must be deterministic and independently validated on both Node and browser implementations.

## Alternatives considered

| Design                                                                          | Benefit                                                                           | Cost / reason not recommended for the first Idle increment                                                            |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Give GEULION a generic `호스트호출(name, args)` function                        | Flexible for arbitrary host APIs                                                  | Exposes an unbounded FFI surface and weakens static capability review.                                                |
| Add direct clock/storage/input prelude functions                                | Easy to call from source                                                          | Couples pure game logic to runtime effects, complicates browser async storage, and makes deterministic replay harder. |
| Keep state transition functions pure and inject values through explicit exports | Small auditable boundary; repeatable state transitions; adapter owns browser APIs | Requires a browser compilation target and an explicit source export mechanism, both deferred implementation work.     |

## Deferred questions and follow-up work

The follow-up design issue resolved these questions in [specification-v0.3-host-api.md](specification-v0.3-host-api.md):

- the exact export syntax and whether a browser module must also define `시작`;
- generated module factory and `invoke` TypeScript signatures;
- concrete serialization limits, malformed payload handling, and compatibility policy for save data;
- how browser diagnostics and GEULION `출력` are presented to the embedding UI;
- the Node adapter policy and cross-target conformance cases.

No browser runtime, persistence adapter, timer, compiler target, syntax, dependency, or public API is implemented merely by documenting these decisions. Implementation and executable conformance remain separate work.
