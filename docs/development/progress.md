# GEULION Development Progress

## Current status

- Current Phase: 6 — Standard Library & Language Evolution (v0.2 implementation)
- Current Issue: [#37 — Implement v0.2 language selection and string utilities](https://github.com/dltldn1234/geulion/issues/37)
- Working branch: `37-feat/v02-language-and-string-stdlib`
- Initial baseline SHA: `afc1b41`
- Initial main commit count: 58 (`git fetch origin` then `git rev-list --count origin/main`)
- Latest main SHA: `04a72ba`
- Initial cumulative commits: 58
- Current cumulative commits on `origin/main`: 69
- New commits reachable from main since baseline: 11 (eight PR commits plus three Merge Commits)
- Local unmerged commits: 5 on Issue #37 (semantic/runtime, CLI, tests, docs, progress record)
- Remaining to minimum 300: 231
- Remaining to primary 400: 331
- Remaining to extended 500: 431
- Completed PRs: [#32](https://github.com/dltldn1234/geulion/pull/32), Merge Commit `8f72dad`, CI passed; [#34](https://github.com/dltldn1234/geulion/pull/34), Merge Commit `6518b9c`, CI run `42506220384` passed; [#36](https://github.com/dltldn1234/geulion/pull/36), Merge Commit `04a72ba`, CI passed.
- Issue #37 implementation is committed locally and not yet pushed or submitted for CI.

## Completed

- Phase 5 issue #31 completed and closed by merged PR #32.
- Work branch `31-feat/runtime-cli` was created from `main` at `afc1b41`.
- Added `run` and `build` CLI workflows on top of `compileSource`.
- `run` executes a generated temporary ESM file with Node.js, inherits stdout/stderr, returns the child exit status, and cleans its temporary directory.
- `build` creates `dist/<source>.mjs` by default or writes to `--out-dir`; generated artifacts are standalone.
- Added CLI process tests for runtime output and failures, build output and default directory, invalid arguments, and Unicode/space-containing paths.
- Updated README/compiler docs and this progress tracker.
- Local implementation commit: `8b832f6` (`✨ feat: add GEULION run and build commands (#31)`).
- Local documentation commit: `eeda2a2` (`📝 docs: document Phase 5 CLI progress (#31)`).
- Branch `31-feat/runtime-cli` was the head of PR #32 and is merged.
- Phase 6 issue #33 tracks a versioned proposal for pure portable string utilities; the proposal is not normative and makes no v0.1 implementation claim.
- Proposal commit: `cef612b` (`📝 docs: propose portable v0.2 string utilities (#33)`).
- PR #34 merged two branch commits plus one Merge Commit; proposal remains Proposed until its API naming and version-selection questions are resolved.
- Issue #35 resolves the proposed API names and argument order, Unicode scalar counting/comparison, and explicit CLI opt-in (`--language-version 0.2`) while keeping v0.1 as default. These are proposal decisions, not implementation.
- Design decision commit: `72f3e42` (`📝 docs: resolve v0.2 string API proposal decisions (#35)`).
- PR #36 merged Issue #35 with three branch commits and Merge Commit `04a72ba`; all CI checks passed.
- Issue #37 adds explicit version selection to `check`, `emit-js`, `run`, and `build`, with the v0.1 prelude preserved by default and four v0.2 scalar-sequence string utilities.
- Issue #37 local commits: `0d36442` string prelude/runtime, `0762e34` CLI version selection, `93cdcd6` cross-command execution tests, and `508d5dc` v0.2 usage/spec status docs.

## Verification

- Baseline repository status was clean except for the pre-existing untracked `pnpm-workspace 2.yaml`; preserve it.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed, 13 test files / 166 tests.
- `git diff --check`: passed.
- Actual process-level run and standalone build execution are covered by the CLI tests above.
- Phase 6 docs proposal: `pnpm format:check` passed; `git diff --check` passed; PR #34 CI passed lint, format, typecheck, test, and build.
- Issue #37 final local verification: `pnpm format:check`, `pnpm typecheck`, `pnpm test` (13 files / 167 tests), `pnpm lint`, and `git diff --check` all passed. Tests cover v0.1 rejection, v0.2 check/emit-js/run/build behavior, Unicode scalar length, exact search behavior, empty inputs, and unsupported CLI versions.

## Known blockers

- GitHub connector writes and branch-protection reads return HTTP 403. Issue/PR creation and regular merges were completed in the authenticated browser. PR #36 showed all checks passed, no conflicts, and an enabled merge action; GitHub confirmed Merge Commit `04a72ba`. The latest fetch confirms `origin/main` has 69 commits.

## Next

1. Push the five Issue #37 commits and open an Issue-linked PR.
2. Verify required review and CI before merging; update main-only commit totals after merge.
3. Continue Phase 6 with real language/library work after Issue #37, tracking only commits reachable from `origin/main` toward the 300/400/500 targets.

## Commit growth tracking

Count only unique commits reachable from `origin/main` for the cumulative total. Report local unmerged commits separately. Never create commits solely to meet a numeric target.
