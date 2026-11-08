# GEULION Language Specification v0.2 Proposal — Portable String Utilities

**Status: Proposed.** This document is a review proposal, not a normative language specification and not an implementation claim. It does not change Language Specification v0.1. The proposal is tracked by [Issue #33](https://github.com/dltldn1234/geulion/issues/33).

## Purpose and boundaries

The first v0.2 standard-library increment should add a small set of pure string queries. They operate only on their arguments, have no side effects, and require no operating-system or browser capability. They do not add imports, modules, mutable collections, exceptions, or general user-defined generics.

These functions are library declarations with fixed signatures, not new keywords or changes to the core expression semantics. The v0.1 prelude (`출력`, `정수로`, `실수로`) retains its exact signatures and behavior. The existing single-file program model also remains unchanged.

## Proposed declarations

| Name         | Signature                    | Proposed behavior                                                                                                                                                      |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `문자열길이` | `(문자열) -> 정수`           | Return the number of Unicode scalar values in the input. A supplementary-plane scalar counts as one; a combining sequence counts as the number of scalars it contains. |
| `문자열포함` | `(문자열, 문자열) -> 불리언` | Return whether the second argument occurs as a contiguous Unicode scalar subsequence of the first. The empty second argument is contained in every string.             |
| `문자열시작` | `(문자열, 문자열) -> 불리언` | Return whether the first argument begins with the second argument, comparing Unicode scalar sequences. The empty second argument matches.                              |
| `문자열끝`   | `(문자열, 문자열) -> 불리언` | Return whether the first argument ends with the second argument, comparing Unicode scalar sequences. The empty second argument matches.                                |

For all four functions, strings are compared exactly as stored: no NFC/NFD normalization, locale collation, case folding, or grapheme-cluster segmentation is applied. A GEULION string is a sequence of Unicode scalar values, so UTF-16 surrogate code units are not the unit of comparison. Results are deterministic and do not depend on the host locale.

### Examples (proposed)

```geul
함수 시작() -> 없음 {
    출력(문자열길이("가😀"))       // 2
    출력(문자열포함("한국어 GEULION", "GEULION")) // 참
    출력(문자열시작("글리온", "글")) // 참
    출력(문자열끝("글리온", "온"))   // 참
}
```

These examples describe the proposal only. They are not v0.1 conformance examples and must not be treated as runnable until a later implementation issue lands.

## Name resolution and diagnostics (proposed)

The declarations would be reserved prelude names, resolved like the current prelude functions. Redeclaration would produce the existing duplicate/prelude-name diagnostic. Calls with incorrect arity or non-string arguments would use the existing static name-resolution and type diagnostics; this proposal introduces no runtime failure or new diagnostic code.

## Versioning and precedence

If accepted, these rules belong to a separately published v0.2 specification. The v0.2 documents must state their own normative entry point and explicit compatibility relationship to v0.1. v0.1 remains immutable and authoritative for programs that select v0.1. An implementation must not expose these proposed declarations as v0.1 behavior.

Host capabilities—including input, clocks, timers, randomness, filesystem access, process information, Node.js APIs, browser APIs, and FFI—are outside this proposal. Each requires a separate contract covering capability boundaries, determinism, errors, and runtime-specific behavior before implementation.

## Review questions before acceptance

- Are the four Korean names clear and consistent with the language's naming style?
- Is Unicode scalar counting the intended public meaning of string length, rather than grapheme-cluster counting?
- Should a follow-up proposal add any other pure operations, or should this surface remain intentionally small?
- Should v0.2 select a version in source files, or should compiler version selection be specified separately?

No implementation should begin until these API and compatibility questions are resolved and the proposal is accepted through the project's normal review process.
