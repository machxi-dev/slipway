# Changelog

All notable changes to Slipway are recorded here. Versions follow [semver](https://semver.org); the version in `.claude-plugin/plugin.json` and the marketplace entry is what consumers pin.

## Unreleased

### Added

- `slipway report [D<n>[.<k>]] [--check]`: a step builder's fixed load, file by file — the always-on memory and the rules it imports, the `step-builder` body, what `slipway lane --step` prints, the area rules the step's paths reach and its conventions skills — against the 40 KB target; `--check` exits 1 over it (§7).
- `bin/slipway.cmd`: the runner for cmd.exe and the Windows PowerShell tool, which Claude Code gives the plugin's `bin/` too but which cannot run the extensionless `bin/slipway`. It runs that same file with `node`; there is no `.ps1`, which PowerShell would pick first and execution policy can refuse. `*.cmd` files are checked out CRLF (§13.1).
- [docs/measurements.md](docs/measurements.md): the fixed load measured on two lanes in the scratch repository, and how to measure it again. A step's fixed load measured 7.7–8.2 KB (about 3k tokens); the steps' builders took 36–37 s and peaked at 24k tokens of context, of which about 12k is Claude Code's own (§9).

### Changed

- An area's rules now load only for a step that works in the area. `slipway digest` writes each area's loader, `.claude/rules/slipway-<area>.md`, with the digest inline instead of an `@` import, because Claude Code reads a rule's imports at session start even when the rule has `paths:`. A repository on 0.1 runs `slipway digest` once; `docs-check` names the loaders until it does (§5.2).
- The default ceilings in `slipway.budget.json` come down to what keeps a step reaching one area under 40 KB: the general digest 12 KB → 8 KB, an area digest 32 KB → 12 KB; `.claude/rules/*.md` is split into `.claude/rules/slipway.md` (1 KB) and `.claude/rules/slipway-*.md` (13 KB, an area's digest inline). A repository on 0.1 makes the same split in its budget file, since a 1 KB ceiling would refuse an inline loader (§7).
- Every skill and agent has its own byte ceiling, its size measured at this release rounded up to 512 bytes; `build` comes down to 5,632 and the agents to 1.5–2.5 KB (§4.1).

- The ledger's table is generated from the plans' headers and the roadmap's planned entries: `slipway ledger generate [--check]`; `docs-check` refuses it stale and refuses a row with no source rather than drop it; `ledger add`, `set` and `ship` regenerate it, and a merge conflict in it is resolved by regenerating (§4.7).
- `/slipway:ship` publishes a GitHub Release for a release tag under `forge: github`, its notes the version's changelog section (§4.5 step 8).

## 0.1.0 — 2026-11-27

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
- The skill `/slipway:scope`: the decisions asked in one batch, the plan and its decisions file, the overlap warning, and on the operator's yes the lane opened (§4.1, §4.2, §4.6).
- The skill `/slipway:build`: a step-builder agent per step, the bounded review, findings back to the same builder, and a comment per step that a resumed run reads; `slipway forge comments`, with forge none keeping its comments in the repository's git dir (§4.3, §4.4).
- The skill `/slipway:ship`: the one stop on the decisions file, the ship commit, the gate and the lane's CI, the merge, the tag and the clean-up (§4.5, §4.6).
- The skill `/slipway:plan`: planned rows and their roadmap entries from a goal, a review or a finding (§4.1, §4.7).

### Fixed

- A lane with no commit of its own gets its draft pull request from `/slipway:build`'s first step, not a refused one at scope; `slipway forge --branch` acts on a branch the checkout does not have checked out (§4.2, §4.3).
- A digest checked out with CRLF line ends (Git for Windows' default) is not stale (§3.2).
- `slipway worktree remove` finishes when Windows holds the emptied worktree folder open, and takes the lane's local comments with it (§4.5).
- `slipway init` runs `claude --version` on Windows without Node's DEP0190 warning.
