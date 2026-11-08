# GEULION Language Specification v0.2 — Portable String Utilities

**Status: Normative for programs compiled with language version 0.2.** This document is the normative entry point for v0.2. The v0.1 rules remain authoritative and unchanged for programs compiled with v0.1; the compiler defaults to v0.1 unless the caller selects v0.2.

## Purpose and boundaries

This v0.2 increment adds a small set of pure string queries. They operate only on their arguments, have no side effects, and require no operating-system or browser capability. They do not add imports, modules, mutable collections, exceptions, or general user-defined generics.

These functions are library declarations with fixed signatures, not new keywords or changes to the core expression semantics. The v0.1 prelude (`출력`, `정수로`, `실수로`) retains its exact signatures and behavior. The existing single-file program model also remains unchanged.

## Standard declarations

| Name         | Signature                    | Behavior                                                                                                                                                                                       |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `문자열길이` | `(문자열) -> 정수`           | Return the number of Unicode scalar values in the input. A supplementary-plane scalar counts as one; a combining sequence counts as the number of scalars it contains.                         |
| `문자열포함` | `(문자열, 문자열) -> 불리언` | Arguments are `(대상, 찾을문자열)`. Return whether the second argument occurs as a contiguous Unicode scalar subsequence of the first. The empty second argument is contained in every string. |
| `문자열시작` | `(문자열, 문자열) -> 불리언` | Arguments are `(대상, 접두문자열)`. Return whether the first argument begins with the second argument, comparing Unicode scalar sequences. The empty second argument matches.                  |
| `문자열끝`   | `(문자열, 문자열) -> 불리언` | Arguments are `(대상, 접미문자열)`. Return whether the first argument ends with the second argument, comparing Unicode scalar sequences. The empty second argument matches.                    |

For all four functions, strings are compared exactly as stored: no NFC/NFD normalization, locale collation, case folding, or grapheme-cluster segmentation is applied. A GEULION string is a sequence of Unicode scalar values, so UTF-16 surrogate code units are not the unit of comparison. Results are deterministic and do not depend on the host locale.

### Examples

```geul
함수 시작() -> 없음 {
    출력(문자열길이("가😀"))       // 2
    출력(문자열포함("한국어 GEULION", "GEULION")) // 참
    출력(문자열시작("글리온", "글")) // 참
    출력(문자열끝("글리온", "온"))   // 참
}
```

These examples require `--language-version 0.2`. They are not v0.1 conformance examples. Executable conformance cases are maintained in [examples.md](examples.md).

## API and compatibility

- Keep the four names shown above. Binary functions receive the target string first and the search, prefix, or suffix string second.
- `문자열길이` counts Unicode scalar values, not grapheme clusters. This matches the existing string model: concatenation and equality operate on exact scalar sequences, and string values are not normalized. Grapheme segmentation would require a separate, versioned Unicode segmentation contract.
- All comparisons use exact Unicode scalar sequences. No normalization, locale collation, case folding, or grapheme segmentation is applied.
- v0.1 remains the default language version. The compiler requires an explicit `--language-version 0.2` opt-in for these declarations. The option applies to semantic compilation commands (`check`, `emit-js`, `run`, and `build`); tokenization and parsing remain version-neutral because this version changes neither tokens nor grammar. No source-level version directive is introduced here.
- A program compiled with v0.2 is represented in its output as ordinary generated code; executing a standalone build does not require the version flag.

These rules define the v0.2 language contract. Their implementation status is recorded in the language index.

## Name resolution and diagnostics

The declarations are reserved prelude names in v0.2, resolved like the current prelude functions. Redeclaration produces the existing duplicate/prelude-name diagnostic. Calls with incorrect arity or non-string arguments use the existing static name-resolution and type diagnostics; these functions introduce no runtime failure or new diagnostic code.

## Versioning and compatibility

These rules apply only when a caller selects language version 0.2. The compiler and CLI default to v0.1, where these declarations are absent. The v0.1 specification remains immutable and authoritative for programs that select v0.1. An implementation must not expose these declarations as v0.1 behavior.

Host capabilities—including input, clocks, timers, randomness, filesystem access, process information, Node.js APIs, browser APIs, and FFI—are outside this version. Each requires a separate contract covering capability boundaries, determinism, errors, and runtime-specific behavior before implementation.

## Implementation status

The four declarations and explicit CLI version selection are implemented and covered by compiler, CLI, and runtime tests. This specification covers only the v0.2 behavior listed here. Host-dependent capabilities remain outside this version increment and require separate specification work.
