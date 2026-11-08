# GEULION Development Progress

## Current status

- Current Phase: 6 — Standard Library & Language Evolution (proposal underway)
- Current Issue: [#33 — Define the v0.2 standard library boundary](https://github.com/dltldn1234/geulion/issues/33)
- Working branch: `33-docs/v02-stdlib-boundary`
- Initial baseline SHA: `afc1b41`
- Initial main commit count: 58 (`git fetch origin` then `git rev-list --count origin/main`)
- Latest main SHA: `8f72dad`
- Initial cumulative commits: 58
- Current cumulative commits on `origin/main`: 62
- New commits reachable from main since baseline: 4 (three PR commits plus Merge Commit)
- Local unmerged commits: 1 on the Issue #33 branch (`cef612b`, proposal and index entry)
- Remaining to minimum 300: 238
- Remaining to primary 400: 338
- Remaining to extended 500: 438
- Completed PR: [#32](https://github.com/dltldn1234/geulion/pull/32), merged as Merge Commit `8f72dad`; latest-head CI passed (workflow run `42505588424`)
- Current Issue #33 branch has no PR or CI result yet. The proposal commit passed `pnpm format:check` and `git diff --check`.

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

## Verification

- Baseline repository status was clean except for the pre-existing untracked `pnpm-workspace 2.yaml`; preserve it.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed, 13 test files / 166 tests.
- `git diff --check`: passed.
- Actual process-level run and standalone build execution are covered by the CLI tests above.

## Known blockers

- The GitHub connector denied issue and pull-request creation with HTTP 403. Issue #31 and PR #32 were created through the authenticated browser. Issue #33 was also created through the browser. The required initial `git fetch origin` and baseline count succeeded; later count verification read the already updated `origin/main` ref.

## Next

1. Review the v0.2 string-utility proposal and refine the API wording if needed.
2. Commit the updated progress record and open a PR for Issue #33.
3. Verify CI and required review policy before merging; recount `origin/main` after merge.

## Commit growth tracking

Count only unique commits reachable from `origin/main` for the cumulative total. Report local unmerged commits separately. Never create commits solely to meet a numeric target.
