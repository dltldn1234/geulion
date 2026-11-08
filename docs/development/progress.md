# GEULION Development Progress

## Current status

- Current Phase: 5 — Runtime & CLI
- Current Issue: [#31 — Add GEULION run and build CLI commands](https://github.com/dltldn1234/geulion/issues/31)
- Working branch: `31-feat/runtime-cli`
- Latest main SHA at start: `afc1b41`
- Latest main commit count at start: 58 (`git fetch origin` then `git rev-list --count origin/main`)
- Initial cumulative commits: 58
- Current cumulative commits on `origin/main`: 58
- New merged commits: 0
- Local unmerged commits: 3 (CLI implementation, usage documentation, and progress tracking)
- Remaining to minimum 300: 242
- Remaining to primary 400: 342
- PR: [#32](https://github.com/dltldn1234/geulion/pull/32), open against `main`
- CI: run `42505514762` was `in_progress` at the last check; verify the latest run before merge.

## Completed

- Phase 5 issue #31 created with implementation and acceptance criteria.
- Local work branch `31-feat/runtime-cli` created from `main` at `afc1b41`.
- Added `run` and `build` CLI workflows on top of `compileSource`.
- `run` executes a generated temporary ESM file with Node.js, inherits stdout/stderr, returns the child exit status, and cleans its temporary directory.
- `build` creates `dist/<source>.mjs` by default or writes to `--out-dir`; generated artifacts are standalone.
- Added CLI process tests for runtime output and failures, build output and default directory, invalid arguments, and Unicode/space-containing paths.
- Updated README/compiler docs and this progress tracker.
- Local implementation commit: `8b832f6` (`✨ feat: add GEULION run and build commands (#31)`).
- Local documentation commit: `eeda2a2` (`📝 docs: document Phase 5 CLI progress (#31)`).
- Branch `31-feat/runtime-cli` is pushed to `origin` and is the head of PR #32.

## Verification

- Baseline repository status was clean except for the pre-existing untracked `pnpm-workspace 2.yaml`; preserve it.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed, 13 test files / 166 tests.
- `git diff --check`: passed.
- Actual process-level run and standalone build execution are covered by the CLI tests above.

## Known blockers

- The GitHub connector denied issue and pull-request creation with HTTP 403. Both were created through the authenticated browser. A subsequent `git fetch origin` retry could not write `.git/FETCH_HEAD` in this environment; the required baseline fetch and count had already succeeded before work began, and pushing the branch succeeded.

## Next

1. Verify CI on the latest PR #32 head and address any failures.
2. Confirm required review and merge only when repository policy allows.
3. Recount `origin/main` after merge and update this progress record with actual merged commit count and next Phase.

## Commit growth tracking

Count only unique commits reachable from `origin/main` for the cumulative total. Report local unmerged commits separately. Never create commits solely to meet a numeric target.
