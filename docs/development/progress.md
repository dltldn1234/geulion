# GEULION Development Progress

## Current status

- Current Phase: 6 — Standard Library & Language Evolution (v0.2 specification and conformance)
- Current Issue: [#39 — Publish normative v0.2 specification and executable conformance cases](https://github.com/dltldn1234/geulion/issues/39)
- Working branch: `39-docs/v02-normative-conformance`
- Initial baseline SHA: `afc1b41`
- Initial main commit count: 58 (`git fetch origin` then `git rev-list --count origin/main`)
- Latest verified main SHA: `0eb762f` (2026-11-09)
- Current unique commits reachable from `origin/main`: 75
- New commits reachable from main since baseline: 17
- Local unmerged commits: 3 on Issue #39 (normative specification, executable conformance, progress tracking)
- Remaining to minimum 300: 225
- Remaining to primary 400: 325
- Remaining to extended 500: 425
- Completed PRs: [#32](https://github.com/dltldn1234/geulion/pull/32), Merge Commit `8f72dad`, CI passed; [#34](https://github.com/dltldn1234/geulion/pull/34), Merge Commit `6518b9c`, CI run `42506220384` passed; [#36](https://github.com/dltldn1234/geulion/pull/36), Merge Commit `04a72ba`, CI passed; [#38](https://github.com/dltldn1234/geulion/pull/38), Merge Commit `0eb762f587a9aae70e9fb539513fcbd5959ca2b1`, CI passed.
- Issue #37 is complete and closed by merged PR #38.
- Issue #39 is implemented and locally verified; its three branch commits are pending push, PR, and CI.

## Completed work

- Phase 5 Issue #31 added Node.js-backed `run` and standalone `build` CLI commands, execution/error propagation, temporary-file cleanup, path handling, tests, and docs. PR #32 merged.
- Phase 6 Issues #33/#35 proposed and resolved the v0.2 string API names, argument order, Unicode scalar semantics, explicit `--language-version 0.2`, and v0.1 compatibility. PRs #34 and #36 merged.
- Issue #37 implemented the explicit version selector and four pure string functions (`문자열길이`, `문자열포함`, `문자열시작`, `문자열끝`) in semantic analysis and the JavaScript runtime. The v0.1 default remains unchanged. PR #38 merged.
- Issue #39 promotes the implemented v0.2 contract to `docs/language/specification-v0.2.md`, keeps v0.1 authoritative for v0.1 programs, and adds P-101/N-009 executable compiler conformance examples.
- Issue #39 commits: `9e6d302` normative v0.2 specification and doc links; `2c0968a` executable v0.2 conformance cases; progress tracking commit is included in the current three-commit branch total.

## Verification

- Pre-existing untracked user file `pnpm-workspace 2.yaml` is preserved and excluded from changes.
- Phase 5 and previous Phase 6 local checks passed; PRs #32, #34, #36, and #38 report passing CI.
- Issue #37 local checks passed: `pnpm format:check`, `pnpm typecheck`, `pnpm test` (13 files / 167 tests), `pnpm lint`, and `git diff --check`.
- Issue #39 local checks passed: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (13 files / 169 tests), `pnpm build`, and `git diff --check`. CI is pending PR creation.

## Known limitations

- GitHub connector writes return HTTP 403. Issue #39 was created in the authenticated browser; use the authenticated browser for Issue/PR actions if the connector remains unavailable.
- Browser merge UI and CI checks must continue to be observed directly. Do not bypass required reviews or repository protection.
- The v0.2 increment covers only the four documented pure string queries. Input, time, timers, randomness, persistence, filesystem, browser APIs, FFI, and modules need separate design/specification before implementation.

## Next

1. Push the three Issue #39 commits and open an Issue-linked PR.
2. Confirm review requirements and CI, then merge using the repository's Merge Commit convention if allowed.
3. Continue Phase 6 by specifying the host/runtime boundaries needed by the planned GEULION Idle application before implementing browser or persistence capabilities.

## Commit growth tracking

Count unique commits reachable from `origin/main` for the cumulative total. Report local unmerged branch commits separately. Minimum target is 300, primary target is 400, extended target is 500. Never create commits solely to meet a numeric target.
