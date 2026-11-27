# Changelog

All notable changes to Slipway are recorded here. Versions follow [semver](https://semver.org); the version in `.claude-plugin/plugin.json` and the marketplace entry is what consumers pin.

## Unreleased

### Added

- The repository skeleton (docs/design.md §13.1): plugin and marketplace manifests, the component folders, this changelog, LF normalisation, and a CI workflow running `node --test` and `claude plugin validate . --strict`.
- `bin/slipway` and `slipway run <name>`: the repository's commands from `slipway.config.json`, the lock across worktrees (§3.3).
- `slipway init`: the config, the three-file ledger, the records index, the digests and their rule loaders, the settings lines, the `CLAUDE.md` sentence and the README setup line (§3.2, §13.4).
- `slipway init` also writes the process record (§5.1) and `slipway.budget.json` (§7), and with `--brownfield` splits a ledger in another shape into the three files (§13.5).
- `slipway adr new` and `slipway adr accept`: record numbering, the status line, supersession and the index (§2, §5).
- The skills `/slipway:init` and `/slipway:adr` (§4.1).
- The step check's plugin half: `slipway run step-check` hands the repository's command the paths changed since the tree last proved green in that worktree (§3.3).
- `slipway digest`, `slipway docs-check`, `slipway lane`, `slipway ledger`, `slipway worktree`, `slipway forge` (github and none), `slipway release bump` and `slipway tag` (§3.2, §4.5, §14).
- The `SessionStart` hook: the lane, its next step and the planned rows, in three lines.
- The lock takes over a dead holder under a claim, and stays held while the command's shell runs (§14).
