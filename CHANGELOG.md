# Changelog

All notable changes to Slipway are recorded here. Versions follow [semver](https://semver.org); the version in `.claude-plugin/plugin.json` and the marketplace entry is what consumers pin.

## 0.3.0 — 2026-11-28

### Added

- `release.title` in `slipway.config.json`: the GitHub Release's title, with `{version}` and `{tag}` filled, the tag itself by default; `"`, backtick, `$`, `\` and line breaks are refused, since the ship quotes it on a command line. A config that sets it needs this version: 0.2 refuses the key as unknown. `slipway release notes [--out <file>]` prints the title and writes the current version's changelog section, and `/slipway:ship` gives both to `gh release create` (§4.5 step 8).
- `slipway forge pr-open --plan <plan>` builds the lane's pull request from its plan: the title `D<n> — <title>` unless `--title` says otherwise, and a body of the plan's goal, its step titles, its path and its `CI:` line. It replaces `pr-open --body-file`, which is refused, with `--plan` or without; a plan outside the repository is refused; `/slipway:scope` and `/slipway:build` use it (§4.2, §4.4).

### Changed

- The process record is [0002](docs/adr/0002-the-process.md), superseding 0001, and the process template `init` writes says the same; a test holds the template's `## Rules` to the record's. A step is its commit plus at most one `fix(<scope>): D<n>.<k> review findings` commit. `/slipway:ship` runs `slipway docs-check` before its commit and no check: the gate on that commit is its one proof. `/slipway:scope` cuts the lane branch before it writes and commits the plan, its decisions file and its records there, and `/slipway:plan` commits its rows on the lane branch of the first row it adds; nothing is committed on the default branch but the ship's merge, so a protected default branch needs no special case. A repository on 0.2 takes the change by superseding its own process record at a lane boundary (§4.1, §4.5, §5.1).

### Fixed

- `slipway ledger next` and `slipway lane --overlap` read the lane branches on the remote, after a fetch, as well as the checked-out tree, so a row planned or a lane opened on its branch is counted before it reaches the default branch; and `slipway lane --step` prints the plan's `## Constraints` before the step's section, so the step builder reads them (§4.2, §4.4).
- `slipway release bump` renames a root `CHANGELOG.md`'s `## Unreleased` heading to `## <version> — <date>`, or Keep a Changelog's `## [Unreleased]` to `## [<version>] - <date>`, and lists the changelog among the files it wrote, instead of leaving the heading for the ship to fix by hand; it refuses a changelog with no `## Unreleased` and then writes nothing. `/slipway:ship` says it tags the merge commit, not the ship commit (§4.5 step 8).
- `slipway worktree remove D<n>` brings the local default branch up to origin before it removes anything, with `git pull --ff-only` where a checkout has it and `git fetch origin <default>:<default>` where none does, so a main checkout on another branch gets the merge too; it removes nothing when that fails. `/slipway:ship` runs it from the main checkout, since on Windows a shell inside the worktree keeps the folder, and no longer pulls separately (§4.5 step 9, §14).

## 0.2.1 — 2026-11-27

### Fixed

- Every command the skills, the agents and the plan template give is one plain command per Bash call, which the permission layer allows: `/slipway:ship` reads `git rev-parse origin/<default>` as its own call after a squash merge and passes the hash to `slipway tag`, instead of substituting it, each agent that runs commands is told to write with Write, change with Edit and search with Grep, and a done-when is a plain command or a test name. A test refuses substitution, expansion, pipes, `&&`, `||`, `;`, redirects, negation, grouping and in-place `sed` in their code spans.

### Changed

- The step builder has no Skill tool, so Claude Code's skill listing (about 21 KB on the D1 run) is no longer in its load: `slipway lane --step` prints each conventions skill's `.claude/skills/<name>/SKILL.md` path, or that it is not found there, and the builder reads each with Read and names a missing one in its report. A conventions skill kept only in a plugin or in user scope no longer reaches the builder. The gate-runner always runs in the foreground with the Bash tool's longest timeout and never polls; a run it cuts off is `BLOCKED: timed out`, and `/slipway:ship` then gives the operator `slipway run gate` to run and takes their result into the evidence comment (§4.4, §4.5, §7).

## 0.2.0 — 2026-11-27

### Added

- A docs site at [machxi-dev.github.io/slipway](https://machxi-dev.github.io/slipway/), built with VitePress in `site/` from the README, the design, the skills, the process record and this changelog, and deployed to GitHub Pages by `.github/workflows/docs.yml`. Its dependencies stay in `site/`; the plugin keeps none (§13.1).
- `slipway report [D<n>[.<k>]] [--check]`: a step builder's fixed load, file by file — the always-on memory and the rules it imports, the `step-builder` body, what `slipway lane --step` prints, the area rules the step's paths reach and its conventions skills — against the 40 KB target; `--check` exits 1 over it (§7).
- `bin/slipway.cmd`: the runner for cmd.exe and the Windows PowerShell tool, which Claude Code gives the plugin's `bin/` too but which cannot run the extensionless `bin/slipway`. It runs that same file with `node`; there is no `.ps1`, which PowerShell would pick first and execution policy can refuse. `*.cmd` files are checked out CRLF (§13.1).
- [docs/measurements.md](docs/measurements.md): the fixed load measured on two lanes in the scratch repository, and how to measure it again. A step's fixed load measured 7.7–8.2 KB (about 3k tokens); the steps' builders took 36–37 s and peaked at 24k tokens of context, of which about 12k is Claude Code's own (§9).

### Changed

- An area's rules now load only for a step that works in the area. `slipway digest` writes each area's loader, `.claude/rules/slipway-<area>.md`, with the digest inline instead of an `@` import, because Claude Code reads a rule's imports at session start even when the rule has `paths:`. A repository on 0.1 runs `slipway digest` once; `docs-check` names the loaders until it does (§5.2).
- The default ceilings in `slipway.budget.json` come down to what keeps a step reaching one area under 40 KB: the general digest 12 KB → 8 KB, an area digest 32 KB → 12 KB; `.claude/rules/*.md` is split into `.claude/rules/slipway.md` (1 KB) and `.claude/rules/slipway-*.md` (13 KB, an area's digest inline). A repository on 0.1 makes the same split in its budget file, since a 1 KB ceiling would refuse an inline loader (§7).
- Every skill and agent has its own byte ceiling, its size measured at this release rounded up to 512 bytes; `build` comes down to 5,632 and the agents to 1.5–2.5 KB (§4.1).

- The ledger's table is generated from the plans' headers and the roadmap's planned entries: `slipway ledger generate [--check]`; `docs-check` refuses it stale and refuses a row with no source rather than drop it; `ledger add`, `set` and `ship` regenerate it, and a merge conflict in it is resolved by regenerating (§4.7).
- `/slipway:ship` publishes a GitHub Release for a release tag under `forge: github`, its notes the version's changelog section (§4.5 step 8).
- The development loop loads the plugin from a separate worktree of `main` (`git worktree add --detach ../slipway-plugin origin/main`), refreshed between lanes, instead of from the working copy: Claude Code 2.1.332 treats every file under a `--plugin-dir` path as sensitive and refuses edits to it (§13.2).
- The README's status line says what works today instead of "the v0.1 skeleton".

### Fixed

- `slipway digest` accepts a successor's carried rule line that cites the parent it supersedes, `(with: <parent>)`, as §14 tells a delta supersession to write it; the chain is read from the successor's `- Supersedes:` line or the parent's `superseded by` status, and a superseded record cited by any other record is still refused (§14).
- `docs-check` reads nothing inside a fenced block of a spec as a requirement, so a specs README can show the shape in an example (§14).
- The lock tests wait, within a bound, until their dead holder's pid is reported gone before they use it, so they no longer flake on Windows, which can report a pid alive for a moment after its process exits.
- `slipway init` gives a file a budget glob reaches, and that is over the glob's ceiling today, its own entry at its size, so a brownfield repository's long shipped plans pass `docs-check` on day one (§12).

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
