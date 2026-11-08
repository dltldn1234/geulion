# GEULION Development Progress

## Current status

- Current Phase: 6 — Standard Library & Language Evolution (v0.3 host API proposal)
- Current Issue: [#41 — Define a versioned host API boundary for GEULION Idle](https://github.com/dltldn1234/geulion/issues/41)
- Working branch: `41-spec/host-api-boundary`
- Initial baseline SHA: `afc1b41`
- Initial main commit count: 58
- Latest verified main SHA: `cc62261e93b67b2519e01e9895a77111680101c1` (2026-11-09)
- Current unique commits reachable from `origin/main`: 79
- New commits reachable from main since baseline: 21
- Local unmerged Issue #41 commits: 2 (`3a3eec4` proposal; progress/index update in this commit)
- Remaining to minimum 300: 221
- Remaining to primary 400: 321
- Remaining to extended 500: 421
- Completed PRs: [#32](https://github.com/dltldn1234/geulion/pull/32), Merge Commit `8f72dad`, CI passed; [#34](https://github.com/dltldn1234/geulion/pull/34), Merge Commit `6518b9c`, CI run `42506220384` passed; [#36](https://github.com/dltldn1234/geulion/pull/36), Merge Commit `04a72ba`, CI passed; [#38](https://github.com/dltldn1234/geulion/pull/38), Merge Commit `0eb762f587a9aae70e9fb539513fcbd5959ca2b1`, CI passed; [#40](https://github.com/dltldn1234/geulion/pull/40), Merge Commit `cc62261e93b67b2519e01e9895a77111680101c1`, CI run `42508397430` passed.

## Completed work

- Phase 5 Issue #31 added Node.js-backed `run` and standalone `build` CLI commands, execution/error propagation, temporary-file cleanup, path handling, tests, and docs. PR #32 merged.
- Phase 6 Issues #33/#35 proposed and resolved the v0.2 string API names, argument order, Unicode scalar semantics, explicit `--language-version 0.2`, and v0.1 compatibility. PRs #34 and #36 merged.
- Issue #37 implemented the explicit version selector and four pure string functions (`문자열길이`, `문자열포함`, `문자열시작`, `문자열끝`) in semantic analysis and the JavaScript runtime. The v0.1 default remains unchanged. PR #38 merged.
- Issue #39 / PR #40 promoted the implemented v0.2 contract to `docs/language/specification-v0.2.md`, retained v0.1 authority for v0.1 programs, and added P-101/N-009 executable compiler conformance examples.
- Issue #41 proposes a versioned, capability-limited host/application boundary for Idle. Design work is in progress; no host API implementation is included.

## Verification

- Pre-existing untracked user file `pnpm-workspace 2.yaml` is preserved and excluded from changes.
- Phase 5 and earlier Phase 6 checks passed; PRs #32, #34, #36, #38, and #40 report passing CI.
- Issue #37 local checks passed: `pnpm format:check`, `pnpm typecheck`, `pnpm test` (13 files / 167 tests), `pnpm lint`, and `git diff --check`.
- Issue #39 local checks passed: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (13 files / 169 tests), `pnpm build`, and `git diff --check`. PR #40 CI run `42508397430` passed.
- Issue #41 proposal reviewed against the current grammar, type system, compiler target, generator, runtime diagnostics, and host boundary; targeted Prettier check and `git diff --check` passed. No runtime code changed, so compiler tests were not run for this documentation-only issue.

## Known limitations

- The v0.2 increment covers only four pure string queries. Input, clocks, timers, randomness, persistence, filesystem access, browser APIs, FFI, and modules are not implemented.
- `docs/language/host-api-v0.3-proposal.md` is a proposal, not a normative contract. It must not be implemented as if the deferred syntax/API decisions were settled.
- The existing generated artifact is Node-specific and auto-runs `시작`; it cannot be treated as browser-ready. A separate browser-module target and explicit export model would be required.

## Next

1. Push Issue #41 and open an Issue-linked PR; confirm CI and review requirements before using the repository's Merge Commit process.
2. After the proposal is reviewed, create focused follow-up Issues for the v0.3 browser-module target and public function exports, then implementation/conformance work.
3. Implement the Idle host adapter and GEULION game logic only after the relevant versioned contracts and Issues are agreed.

## Commit growth tracking

Count unique commits reachable from `origin/main` for the cumulative total. Report local unmerged branch commits separately. Minimum target is 300, primary target is 400, extended target is 500. Never create commits solely to meet a numeric target.
