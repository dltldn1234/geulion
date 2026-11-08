# GEULION Development Progress

## Current status

- Current Phase: 6 — Standard Library & Language Evolution (proposal review)
- Current Issue: [#35 — Resolve v0.2 string utility naming and version selection](https://github.com/dltldn1234/geulion/issues/35)
- Working branch: `35-docs/v02-finalization`
- Initial baseline SHA: `afc1b41`
- Initial main commit count: 58 (`git fetch origin` then `git rev-list --count origin/main`)
- Latest main SHA: `6518b9c`
- Initial cumulative commits: 58
- Current cumulative commits on `origin/main`: 65
- New commits reachable from main since baseline: 7 (five PR commits plus two Merge Commits)
- Local unmerged commits: 3 on Issue #35 (design decision, progress tracking, and this final status update)
- Remaining to minimum 300: 235
- Remaining to primary 400: 335
- Remaining to extended 500: 435
- Completed PRs: [#32](https://github.com/dltldn1234/geulion/pull/32), Merge Commit `8f72dad`, CI passed; [#34](https://github.com/dltldn1234/geulion/pull/34), Merge Commit `6518b9c`, CI run `42506220384` passed.
- Current Issue #35 branch has no PR or CI result yet; proposal formatting and diff checks pass.

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

## Verification

- Baseline repository status was clean except for the pre-existing untracked `pnpm-workspace 2.yaml`; preserve it.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed, 13 test files / 166 tests.
- `git diff --check`: passed.
- Actual process-level run and standalone build execution are covered by the CLI tests above.
- Phase 6 docs proposal: `pnpm format:check` passed; `git diff --check` passed; PR #34 CI passed lint, format, typecheck, test, and build.

## Known blockers

- GitHub connector writes and branch-protection reads return HTTP 403. Issue/PR creation and regular merges were completed in the authenticated browser. PR #34 showed all checks passed, no conflicts, and an enabled merge action; its merge was accepted by GitHub. The initial baseline fetch and count succeeded, and `origin/main` was fetched again after PR #34.

## Next

1. Commit the updated progress record and open a PR for Issue #35.
2. Verify CI and repository review requirements, then merge only if allowed.
3. After design acceptance, create a separate issue for implementation and conformance tests.

## Commit growth tracking

Count only unique commits reachable from `origin/main` for the cumulative total. Report local unmerged commits separately. Never create commits solely to meet a numeric target.
