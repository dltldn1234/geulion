# GEULION Development Progress

## Current status

- Current Phase: 6 — Standard Library & Language Evolution (v0.3 public exports)
- Current Issue: [#45 — Parse and resolve v0.3 public function exports](https://github.com/dltldn1234/geulion/issues/45)
- Working branch: `45-feat/v03-public-exports`
- Initial baseline SHA: `afc1b41`
- Initial main commit count: 58
- Latest verified main SHA: `6b30d98f534c0ff8c3acbbdca50086f0fd9ff325` (2026-11-09)
- Current unique commits reachable from `origin/main`: 85
- New commits reachable from main since baseline: 27
- Local unmerged Issue #45 commits: 4 (three implementation commits and this progress/documentation commit)
- Remaining to minimum 300: 215
- Remaining to primary 400: 315
- Remaining to extended 500: 415
- Completed PRs: [#32](https://github.com/dltldn1234/geulion/pull/32), Merge Commit `8f72dad`, CI passed; [#34](https://github.com/dltldn1234/geulion/pull/34), Merge Commit `6518b9c`, CI run `42506220384` passed; [#36](https://github.com/dltldn1234/geulion/pull/36), Merge Commit `04a72ba`, CI passed; [#38](https://github.com/dltldn1234/geulion/pull/38), Merge Commit `0eb762f587a9aae70e9fb539513fcbd5959ca2b1`, CI passed; [#40](https://github.com/dltldn1234/geulion/pull/40), Merge Commit `cc62261e93b67b2519e01e9895a77111680101c1`, CI run `42508397430` passed; [#42](https://github.com/dltldn1234/geulion/pull/42), Merge Commit `30f9f5c07d563fd5867e92cdc5924f56b7cd0b7e`, CI run `42534464926` passed; [#44](https://github.com/dltldn1234/geulion/pull/44), Merge Commit `6b30d98f534c0ff8c3acbbdca50086f0fd9ff325`, CI run `42536546327` passed.

## Completed work

- Phase 5 Issue #31 added Node.js-backed `run` and standalone `build` CLI commands, execution/error propagation, temporary-file cleanup, path handling, tests, and docs. PR #32 merged.
- Phase 6 Issues #33/#35 proposed and resolved the v0.2 string API names, argument order, Unicode scalar semantics, explicit `--language-version 0.2`, and v0.1 compatibility. PRs #34 and #36 merged.
- Issue #37 implemented the explicit version selector and four pure string functions (`문자열길이`, `문자열포함`, `문자열시작`, `문자열끝`) in semantic analysis and the JavaScript runtime. The v0.1 default remains unchanged. PR #38 merged.
- Issue #39 / PR #40 promoted the implemented v0.2 contract to `docs/language/specification-v0.2.md`, retained v0.1 authority for v0.1 programs, and added P-101/N-009 executable compiler conformance examples.
- Issue #41 / PR #42 documented a versioned, capability-limited host/application boundary for Idle. Issue #43 / PR #44 finalized the v0.3 browser module, export syntax, invocation ABI, value validation, and save-envelope design.
- Issue #45 implements contextual `공개 함수` parsing, v0.3 public signature metadata, and the v0.3 `check` selector; implementation work is on the current branch pending PR/CI.

## Verification

- Pre-existing untracked user file `pnpm-workspace 2.yaml` is preserved and excluded from changes.
- Phase 5 and earlier Phase 6 checks passed; PRs #32, #34, #36, #38, #40, #42, and #44 report passing CI.
- Issue #37 local checks passed: `pnpm format:check`, `pnpm typecheck`, `pnpm test` (13 files / 167 tests), `pnpm lint`, and `git diff --check`.
- Issue #39 local checks passed: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (13 files / 169 tests), `pnpm build`, and `git diff --check`. PR #40 CI run `42508397430` passed.
- Issue #41 proposal was reviewed against the current grammar, type system, compiler target, generator, runtime diagnostics, and host boundary; targeted Prettier check and `git diff --check` passed. No runtime code changed, so compiler tests were not run for that documentation-only issue.
- Issue #43 normative contract was checked against the current compiler API, generator/source-map model, diagnostics, and v0.1/v0.2 compatibility constraints. PR #44 merged after its CI passed.
- Issue #45 local verification passed: full `pnpm test` (13 files / 179 tests), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `git diff --check`.

## Known limitations

- The v0.2 increment covers only four pure string queries. Input, clocks, timers, randomness, persistence, filesystem access, browser APIs, FFI, and modules are not implemented.
- The v0.3 public syntax and semantic export metadata are implemented on the current unmerged branch. Browser code generation, invocation ABI, and persistence adapter are still separate work.
- The existing generated artifact is Node-specific and auto-runs `시작`; it cannot be treated as browser-ready. A separate browser-module target and explicit export model would be required.

## Next

1. Finish Issue #45 review, push the implementation branch, and open its Issue-linked PR; require CI before Merge Commit.
2. Implement the v0.3 browser generator and target CLI, then the invocation/value-validation ABI and Node/browser conformance in focused Issues.
3. Build the Idle host adapter and game logic against the implemented and conforming v0.3 contract.

## Commit growth tracking

Count unique commits reachable from `origin/main` for the cumulative total. Report local unmerged branch commits separately. Minimum target is 300, primary target is 400, extended target is 500. Never create commits solely to meet a numeric target.
