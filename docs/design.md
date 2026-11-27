# Slipway — design

Slipway is a Claude Code plugin that gives a repository a **scope → build → ship** workflow: decisions as records with an amendment window, one-page plans whose done-whens are commands and test names, one bounded review per step, a branch and a pull request per deliverable, and a gate that machines run. This document is the design the first versions build to. It was distilled on 2026-11-27 from a review of the method as it ran for two months inside one product monorepo, with everything particular to that repository left out; what remains is the method and the plugin that carries it. Nothing here binds until a record in this repository carries it (§9 says when that starts).

## 1. Summary

The method works when the machinery stays out of the way: in its first home, steps closed in one to three hours each and the build itself was never the cost — orientation, review and the close were. What grew around it was the problem: the process stated across eleven records in a supersession chain, four skills totalling 49 KB, a 46 KB process digest, and a fixed orientation of 120–200 KB of process text before a builder read a line of code.

Slipway's answer, in one paragraph: **the process is a versioned plugin with its own namespace** (`/slipway:plan`, `/slipway:scope`, `/slipway:build`, `/slipway:ship`, `/slipway:adr`, `/slipway:init`), installable in any repository and colliding with none of Claude Code's own commands; **one `build` command** runs steps in forked builder agents from a flat orchestrator; **lanes are derived from branches**, with the operator deciding what opens; **`ship` is one stop, one local gate under a lock, a merge commit and a tag**; **CI is a per-lane setting** (`CI: on | at-ship | off` in the plan header); **a step's note is split** into narrative in the commit body and a small editable decisions file; **`plan`** turns findings into ledger rows for the day the planned rows run out; **rule lines live in the records** and the digests regenerate from them; and **models are routed by role** — the session's model for scoping and building, a strong model for review, a small one for running checks, scripts for everything mechanical.

Target, as estimates from file sizes rather than measured sessions: a step's fixed load under 40 KB; the process skills about 20 KB in total; zero description text carried into every session for process commands (`disable-model-invocation`). Parallel lanes stay.

## 2. The method Slipway encodes

These earned their place in two months of use and the plugin keeps them as they are:

- **Records as the source of truth**: `proposed → accepted → superseded`, delta supersessions that leave the parent standing for what they do not touch, an amendment window while a deliverable that names the record is in progress, acceptance at the head of the step that builds it.
- **Generated digests by area**, loaded by path-scoped rule files, so a session reads the rules in force for where it is and opens a record only when a line is not enough.
- **One-page plans** with done-whens that are commands and test names, no close-out step, steps cut as large as a builder can hold whole.
- **The step check against the last proved tree**, and the repository's own check command as the inner loop. A cached result is a proof; nothing bypasses the cache.
- **One bounded review per step, in a fresh context, never by the builder itself**; a reviewer per part when parts share no file.
- **A branch and a draft pull request per lane, a worktree per lane, a per-lane environment, a lock across worktrees**, and a merge commit at ship so step commits survive on the default branch.
- **Decisions asked at scope in one batch; a step never stops on an operator's decision** — it takes one provisionally and the ship ratifies or overturns it.
- **Behaviour specs** updated in the same diff as the behaviour, where a repository keeps them.
- **Byte ceilings on every file a session is told to read**, checked by the same hygiene command as the documents' shape.

And the lessons the review drew, which shape what follows:

1. Bundled Claude Code commands such as `/ship` are reserved names: a project skill of the same name is not loaded at all. A namespace is the only clean answer.
2. A process stated as a chain of deltas is read as a chain; a session wanting "the rule" should find one record and one short skill.
3. Lane machinery has two load-bearing parts on one machine — an environment per branch and a lock across worktrees — and several prose-bearing ones (lane files, a generated window paragraph, tiers, a disjointness gate) that the operator was already doing by judgement.
4. Shipping should write each fact once. The first home wrote the same close in six places.
5. Provisional decisions multiply when the operator's class is wide; the ship's ratification becomes a long batch answered "all".
6. Claude Code now has the primitives the skills emulated in prose: `context: fork` with `agent:`, `skills:` preloading into an agent, `model` and `effort` per skill and per agent, `disable-model-invocation`, plugin namespaces, `SubagentStop` and `Stop` hooks.

## 3. The plugin

### 3.1 Why a plugin, and which kind

A plugin is the one Claude Code mechanism that gives commands a namespace (`/<plugin>:<skill>`), carries agents, hooks and scripts together, and is installable into any repository with one settings line. Two ways to ship one:

- **A plugin repository that is its own marketplace** (chosen). `machxi-dev/slipway`, versioned, with `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. Each consuming repository lists it in `.claude/settings.json` under `enabledPlugins` with `extraKnownMarketplaces`; a clone installs it with `claude plugin install slipway@slipway --scope project`. Consumers pin a version; the process evolves in one place and each takes it by bumping.
- **A skills-directory plugin inside a repository**. Loads for everyone who clones, no install step, but lives in one repository and is copied, not shared. Good for a week; wrong for "use in new repositories".

**Slipway alters nothing of Claude Code's own.** With the namespace there is no collision: `/ship` stays Claude's (commit, open a pull request, watch it — right for an ad-hoc fix branch) and `/slipway:ship` is the lane close. The plugin does not hide, override or hook the bundled skills, and a consuming repository's settings do not either; one sentence in the consumer's `CLAUDE.md` says which command closes a lane. A `/ship` typed on a lane branch by mistake commits and pushes to the lane's pull request and starts a watch, which `/ship stop` ends — annoying, not destructive.

### 3.2 What is in the plugin, what stays in a repository

| In the plugin (generic) | In the consuming repository |
| --- | --- |
| Skills: `plan`, `scope`, `build`, `ship`, `adr`, `init`. All `disable-model-invocation: true` (operator-typed only, so their descriptions leave every session's context), `user-invocable: true`. | The repository's conventions skills — one per area, which the builder preloads by name. |
| Agents: `step-builder`, `code-reviewer`, `adr-reviewer`, `security-reviewer`, `adr-author`, `gate-runner`. | Agents that know the product's layering, or (preferred) that knowledge folded into the conventions skills. |
| Scripts, dependency-free Node, behind one runner: `run` (commands and the lock), `docs-check` (ledger shape, plan shape, decisions file, spec shape, byte budgets), `rules-digest`, `proved-tree` (the plugin's half of the step check), `lane-worktree`, `forge` (the `gh` / `glab` / none adapter), `init`. | `slipway.config.json` (§3.3): the commands, the lane setup, the forge, the docs paths, the areas and their skills. The repository's own `step-check` and `lane.setup` commands. |
| `hooks/hooks.json`: one `SessionStart` hook printing the current branch's lane, its next unchecked step and the count of planned rows — orientation in three lines instead of reading the ledger. | `.claude/settings.json` (`enabledPlugins`, permissions), `.claude/rules/*.md` path loaders, `CLAUDE.md`. |
| Templates: the ledger, a record, a plan, the decisions file, the config, a rules loader, the settings fragment, and the process record (§5), copied by `init`. | `docs/adr/`, `docs/plan/`, `docs/rules/`, `docs/specs/` — the content. |

`init` makes a repository ready: it writes the empty ledger with its tag prefix, the records index, the digests folder, `slipway.config.json`, the settings lines and the rule loaders. A repository that is itself a published artefact — this one is the first — sets `release` in the config, and the ship bumps and tags a semver version instead of `<prefix>-D<n>` (§4.5 step 8, §9).

### 3.3 The line between plugin and repository

The plugin owns what is the same in every repository — the ledger, plans, records, digests, decisions files, branches, worktrees, pull requests, the lock, the proved-tree record — and **never runs a build tool by name**. Everything that depends on the stack is a command the repository names in `slipway.config.json`, and the plugin runs it through one runner, `slipway run <name>`: a dependency-free Node script shipped in the plugin's `bin/`, which Claude Code puts on the Bash tool's `PATH`, that resolves the command, takes the lock when the command is listed under one, and spawns it through the platform's shell. The skills say `slipway run check`, `slipway run step-check`, `slipway run gate`, and never `pnpm`, `npm`, `make` or `cargo`.

A pnpm monorepo's config, as an example:

```json
{
  "version": 1,
  "defaultBranch": "main",
  "forge": "github",
  "tagPrefix": "app",
  "docs": {
    "records": "docs/adr",
    "plans": "docs/plan",
    "digests": "docs/rules",
    "specs": "docs/specs"
  },
  "lane": {
    "branch": "lane/D{n}",
    "worktree": "../{repo}-D{n}",
    "copy": [".env"],
    "setup": "pnpm db:lane"
  },
  "commands": {
    "check": "pnpm check",
    "step-check": "pnpm step:check",
    "gate": "pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check",
    "format": "pnpm exec prettier --write"
  },
  "locks": { "tiers": ["step-check", "gate"] },
  "ci": { "default": "at-ship", "workflow": "gate.yml", "main": "on" },
  "release": null,
  "merge": "merge-commit",
  "areas": {
    "api-and-data": {
      "paths": ["apps/api/**", "packages/db/**"],
      "skills": ["api-conventions"]
    },
    "frontend": {
      "paths": ["apps/web/**", "packages/ui/**"],
      "skills": ["frontend-conventions"]
    }
  }
}
```

Three consequences:

- **The step check splits in two.** The plugin's half is generic: it records the tree a green run proved (a file list and a head, in the worktree's git directory), computes the changed paths since it, and hands them to the repository's `step-check` command in a file named by `SLIPWAY_CHANGED_PATHS`, with `SLIPWAY_BASE` beside it. The repository's half knows its own tools — a monorepo's task graph, a test runner's "related files" mode, a bundle budget. Another stack writes its own in twenty lines, or names its whole test command and accepts that a step runs more than it reaches.
- **The lane's environment is a command, not a mechanism.** `lane.setup` runs once when a lane's worktree is made, with `SLIPWAY_LANE` (`d45`) and `SLIPWAY_BRANCH` in its environment. One repository creates a database per lane; another starts a compose project or creates a schema; many have no setup at all.
- **The forge is an adapter.** `github` uses `gh` for the four verbs the process needs — open a draft pull request, read a workflow run, comment, merge; `gitlab` would use `glab` for the same four; `none` has no pull request: the ship merges the lane into the default branch locally with `--no-ff` and pushes, the commit bodies and the decisions file are the record, and `CI:` can only be `off`. v0.1 ships `github` and `none`.

The plugin's scripts have **no dependencies**: Node's standard library only. A generated file is written as the generator renders it and then passed to `commands.format` when the repository names one, so the byte-for-byte comparison in `docs-check` is made after the repository's own formatter has run.

## 4. The process

### 4.1 Six commands

- **`/slipway:plan`** — turn a goal, a review or a finding into ledger rows. A conversation: what the deliverable is in one line, which track, what it needs, which records it will likely write or touch. Writes `planned` rows and nothing else; no plan file, no record numbers. Also offered when `/slipway:ship` finds fewer than two `planned` rows.
- **`/slipway:scope [D<n>]`** — read the row and the code; list the decisions; ask the operator's in one batch, the lane's `CI:` value among them (§4.6); write the one-page plan and the `proposed` records; commit on the default branch; on the operator's yes open the lane — move the row to `in progress`, cut the lane branch, make its worktree and run `lane.setup`, open the draft pull request through the forge adapter. A bare call scopes the first `planned` row.
- **`/slipway:build [D<n> | D<n>.<step>] [--one]`** — the lane is read from the current branch (`lane/D45` → D45); the argument is needed only on the default branch. Default: build every unchecked step, each in a forked `step-builder` agent, until none remains or one is blocked. `--one` or `D<n>.<step>`: one step. §4.4.
- **`/slipway:ship [D<n>]`** — close the lane. §4.5.
- **`/slipway:adr`** — write or supersede a record, and accept a `proposed` one at a step's head.
- **`/slipway:init [--brownfield]`** — make a repository ready (§3.2, §12).

Six skills at about 3–6 KB each, written as numbered checklists with the governing record's section cited once at the top, no citation chains in the body. Byte ceilings in `docs-check`: `scope`, `build`, `ship` ≤ 6,144 bytes each; `step-builder` ≤ 4,096.

### 4.2 Lanes from branches — the operator decides what opens

Keep:

- A branch, a worktree and a draft pull request per lane; git does the isolation.
- A per-lane environment made once by the repository's `lane.setup` command from the branch name, with no variable the operator has to export.
- The lock across worktrees for the commands the config lists under it.
- One rule: a record may be amended in place only while a plan that names it in its `Records:` line is `in progress`; otherwise it changes by supersession. The ledger's `in progress` rows **are** the list of open lanes.

Not carried over from the method's first home:

- Lane files, a generated window paragraph, a `- Tier:` line with tiers, a `- Schema:` line.
- The refusal of a bare build command when two lanes are open: the branch says which lane.
- Per-deliverable history files as a requirement. A lane's story is its pull request: the plan link in the body, the decisions and the gate summary as comments, the merge commit on the default branch.

Kept as a warning, not a gate: `/slipway:scope` reads the `Records:` lines of every `in progress` plan and says when the new plan names one of them, and when two `in progress` plans would both add migrations. Twenty lines of script against plan headers that already exist; the operator decides. The ledger's window section is its four rules and the sentence "the open lanes are the `in progress` rows".

### 4.3 What a step writes down, and where

A note appended to a file per step — narrative, provisional decisions, review findings, the step check's output — is read by nobody until the ship, when the provisional lines are fished out of 30–90 KB of prose. The replacement splits the note by one question: **does this text change state later?**

**Narrative that never changes** — what was built, the step check's output, the review's findings and their fates, flakes, the time the step took — goes in **the commit body**, in a fixed template (`Built:`, `Step check:`, `Review:`, `Flakes:`, `Time:`), and `/slipway:build` posts the same text as **one pull request comment per step**. The commit carries it onto the default branch through the merge commit, so nothing is lost when the branch is deleted; the comment is where the operator reads it while the lane runs.

**State that changes** — a provisional decision until it is ratified or overturned, an owed item until it is paid — goes in **`docs/plan/<n>.decisions.md`**, one line each, small and editable: `- Provisional (D<n>.<step>): took X; declined Y; overturning costs Z.` The ship marks each `Ratified YYYY-MM-DD` or `Overturned YYYY-MM-DD, <what replaces it>`; an owed item gets `Paid D<m>.<step>` when it lands, or `Carried YYYY-MM-DD to D<m>` when the operator leaves it to a later lane, whose roadmap entry then names it. The operator's class is narrow: a schema change, a wire shape or status a client already consumes, a security behaviour, a runtime dependency, an environment variable, and anything on the repository's "ask before" list. Not: a new error code's name, a query parameter's name, a label, a test's name, which of two equivalent indexes.

Quality control under the split:

- `/slipway:build` does not tick a step whose commit body lacks the template's sections, and does not close one whose diff takes a decision of the operator's class without a line in the decisions file; the reviewer reports the omission as a finding.
- The reviewer reads the step's plan section and the decisions file.
- `docs-check` refuses a `shipped` plan while its decisions file holds an open line.
- `/slipway:ship`'s one stop reads the decisions file, not the narrative, so the batch is short and every line in it needs an answer.
- The pull request's comments and the decisions file together are the lane's record.

### 4.4 `/slipway:build` on Claude Code's own primitives

The loop is defined in frontmatter and agent bodies, not described in prose for a general-purpose subagent to follow:

- `step-builder` is an agent: `model` set explicitly (§6), `skills:` preloading the repository's conventions skills named in the config for the paths the step touches (one load at start, no Skill round-trip), `tools` without `Agent` (a builder never reviews its own diff), `maxTurns` bounded. Its body is the build procedure: orient on **the step's section** of the plan, not the whole plan; read the records the step names; implement; `slipway run check` as the loop; `slipway run step-check` green; tick the box; commit with the note in the body; push. Under 4 KB.
- The `build` skill is the orchestrator and keeps the main context's tools. For each unchecked step: `Agent(step-builder)` in the foreground; then the review — `code-reviewer`, `adr-reviewer` or `security-reviewer` by what the diff touches, one per part when the plan names parts, launched together; confirmed findings go **back to the same builder** by message, which already holds the step in context, and it re-runs the step check and pushes a follow-up commit. Then the next step.
- State is the plan's checkboxes and git, so an interrupted loop resumes with the same command.
- Stopping rules: one retry for a transient failure; stop on a blocker or the "ask before" list; never run checks in the orchestrator's context.
- CI follows the lane's `CI:` header (§4.6). `on`: the builder reads the last run on the branch before it builds and fixes forward. `at-ship` or `off`: the builder puts `[skip ci]` in the commit body and the step is proved by the step check alone.

### 4.5 `/slipway:ship`, nine steps

1. On the lane branch, every step ticked, or stop and say which is not.
2. Merge the default branch in; conflicts in generated files are resolved by regenerating.
3. **The one stop**: the open lines of the decisions file and the operator's own items (browser walks, deployments), in one batch. Overturned lines are fixed forward now; every line is marked.
4. Regenerate digests; records read `accepted`; the row moves to `SHIPPED.md` with its date (§4.7); one changelog line; `slipway run check`; commit and push — without `[skip ci]` when the lane's `CI:` is `on` or `at-ship`, so this is the one run an `at-ship` lane gets.
5. The gate, under the lock, in the background, on that commit — `slipway run gate` — plus the other machine items of the definition of done. Red in what the lane reaches: fix forward, re-run. Red only outside the lane's reach: say so and ask. With `CI:` `on` or `at-ship`, wait for the run on the same head after the gate has ended; a red run is fixed forward the same way.
6. One pull request comment: the commands, their counts and durations, the machine, the run's result or that the lane ran with `CI: off`.
7. Mark the pull request ready and merge it with a merge commit through the forge adapter. Where the session's permission layer refuses, hand both commands to the operator and continue on "merged". With `forge: none`, merge locally with `--no-ff` and push.
8. Tag the merge commit with a one-line annotation pointing at the pull request; the evidence lives in the comment, not the tag. The tag's name comes from the config: `<tagPrefix>-D<n>` by default, or, where a `release` block is set, the ship first bumps the version in `release.versionFile` (and each file under `release.also`) in step 4's commit — the plan header's `- Release: patch | minor | major` line says which part, asked at scope — and tags `release.tag` with it, `v0.2.0`. A repository that is a published artefact is versioned by semver, not by deliverable number, and the two are never both tags on one commit.
9. Delete the branch and the worktree; if fewer than two `planned` rows remain, offer `/slipway:plan`, else `/slipway:scope`.

### 4.6 CI as a per-lane setting

CI is neither always on nor always off: some projects pay for it, some lanes want it. The switch is a line in the plan header, since the plan is already the lane's own document:

```
- CI: on | at-ship | off
```

- **`on`** — steps push normally; `/slipway:build` reads the last run of `ci.workflow` before each step and fixes forward; `/slipway:ship` waits for the run on the ship commit beside the machine's gate. Needs a forge that can read runs.
- **`at-ship`** — steps push with `[skip ci]`, so no workflow starts; the ship commit goes without it, so exactly one run proves the merged tree.
- **`off`** — every commit carries `[skip ci]`; the ship comment says no run was made. The only value under `forge: none`.

`[skip ci]` is honoured by GitHub Actions, GitLab CI, Azure Pipelines, CircleCI and Buildkite; Jenkins needs a plugin for it. A CI system that ignores the marker turns `at-ship` and `off` into `on` for cost, which the operator should know when choosing the default.

The default comes from the config (`ci.default`), `/slipway:scope` asks it in the decision batch, and the line may be edited mid-lane: each step reads the header when it starts. Pushes to the default branch follow `ci.main`, never a lane's. Two consequences: a forge's "required status check" protection cannot be on while any lane may be `off` or `at-ship`, since it would block that lane's merge — the ship skill makes the check instead; and a lane that must have CI enforced by the forge can use a distinct branch prefix a ruleset targets, which v0.1 does not start with.

### 4.7 The ledger, split by what reads it

The ledger is the file every process command reads first, so its size is paid on every command. In its first home it reached 70 KB, most of it not the ledger: a 300-character scope line per row, padded by the formatter, and a build plan grown into a second planning document. Slipway's ledger is three files from the start:

- **`docs/plan/README.md` — the ledger proper.** The header with the tag prefix, the four rules, the window sentence, and a table of three narrow columns: the number linking to its plan, the title, the status, for the `planned` and `in progress` rows alone. A few kilobytes; what the commands read. A `planned` row whose plan is not yet written carries its one-line scope in `ROADMAP.md`.
- **`docs/plan/ROADMAP.md` — the build plan.** Tracks, what each deliverable needs, the order, the candidates, what blocks a stage. `/slipway:plan` owns it; `/slipway:scope` reads one row's entry when it cuts a plan; nothing else reads it.
- **`docs/plan/SHIPPED.md` — the shipped rows**, with their dates, where `/slipway:ship` moves a row.

Each has its own ceiling in `docs-check`. The end state, built for v0.2: the table is **generated from the plan files' headers**, with `docs-check` refusing it stale, so each lane edits only its own plan file and the ledger stops being a merge surface — which is what makes a branch-first `scope` conflict-free. `slipway ledger generate` takes a row from its plan while the plan's `Status:` is `planned` or `in progress`, none from a `shipped` plan, and, for a `planned` row whose plan is not yet written, the row from its `### D<n> — <title>` entry under the roadmap's `## Planned`, which `/slipway:plan` writes; it replaces the table's rows and nothing else in the file. Two lanes that change adjacent rows still meet in a textual conflict when one merges the other's ship; the conflict is resolved by regenerating, never by hand, and the comparison is of rows, not bytes, so a formatter's padding is no matter. A row in the table with no plan, no roadmap entry and no shipped row is refused rather than dropped, since the table would be the only place its title is written. Structured data (a JSON or YAML ledger rendered to Markdown) was considered and declined: it buys little over a generated table for fifty rows, and the registry-less answer of spec-kit and OpenSpec — the folder listing is the ledger — only works where nothing cross-references rows.

## 5. One record for the process, one source for the digests

### 5.1 The process record

Slipway ships **one process record** as a template, about 120 lines, stating the whole method as §2 and §4 have it: lanes from branches, the step check, one review, decisions, the ship, the plugin as the carrier, byte budgets. `init` copies it into a consuming repository as its first record, so a session wanting "the rule" finds one record and one short skill. A repository that already runs the method on a chain of records supersedes the chain with this record, whole, and regenerates its process digest from it — under 12 KB where the chain's digest was 46.

### 5.2 Rule lines live in the records

A record that governs code carries a `## Rules` section: one list item per rule — the topic in bold, the rule's text as a digest line prints it, then `(with: <ids>)` for any further record the line cites and `(areas: <slugs>)` for the digests it joins. The generator reads the records folder, takes the `## Rules` of every record whose status is `accepted`, writes one digest per area in record order, and refuses a line over 120 words. The records stay the source of truth; there is no second file to write. Accepting a record is one status flip, and its rules reach the digests at the next `slipway digest`.

## 6. Models by role

| Role | Model | Effort | Why |
| --- | --- | --- | --- |
| `plan`, `scope` (conversation, decisions) | the session's (`inherit`) | default | The highest-leverage judgement in the loop; the operator picks the session model with `/model`. |
| `build` orchestrator | `sonnet` on the skill | medium | It dispatches, reads short reports and decides continue or stop; no code in its context. |
| `step-builder` | `opus`, set explicitly | high | Builds code; `inherit` would take the orchestrator's model, so the agent names its own. |
| `code-reviewer`, `adr-reviewer`, `security-reviewer` | `opus` | high | Review is the one pass; strong, but a bounded diff does not need the top tier. |
| `gate-runner` | `haiku` | low | Runs commands and reports pass or fail with the failing output only. |
| `adr-author` | `inherit` | default | Writes records; runs inside `scope`. |
| Mechanical steps (digest, ledger row, tag) | none | — | Scripts. A skill step that is a command should be a command. |

Two cautions from the docs: a subagent on a different model does not inherit the session's effort, so each agent sets `effort`; and `CLAUDE_CODE_SUBAGENT_MODEL` does not override an agent's own `model` unless `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, which is the knob for an all-Sonnet cheap day.

## 7. The budget

Estimates from file sizes at about four bytes a token; the method's first home as the baseline, Slipway as the target. `slipway report` prints a step's actual fixed load, and v0.2's done-when is that figure under 40 KB.

| What a fresh step builder loads before reading code | Baseline | Slipway |
| --- | --- | --- |
| Always-on: `CLAUDE.md`, rule loaders | 6 KB + 1–4 KB | 4 KB + 1 KB |
| The procedure | a loop prompt 1.5 KB + a step skill 13.2 KB | `step-builder` body 4 KB |
| Process rules | a 46 KB digest | ≤ 12 KB |
| Area rules | 14–62 KB per area, more when adding to a shared list | ≤ 32 KB per area, a 120-word cap on new lines |
| The plan | the whole file, 20–40 KB | the step's section, 2–5 KB, plus the header |
| Fixed load | ≈ 120 KB (≈ 30k tokens), up to 200 KB | ≈ 40 KB (≈ 10k tokens) |
| Skill descriptions every session carries for the process | 6 skills × up to 1.5k characters | 0 (`disable-model-invocation`) |

The records a step names and the spec are unchanged and are the right thing to spend tokens on.

## 8. Decisions taken

Each was put with a recommendation and taken as recommended, unless noted.

1. **Name and namespace.** `slipway`: the repository, the plugin's `name` and the marketplace's. The commands are `/slipway:<skill>`, the runner `slipway run`, the environment variables `SLIPWAY_*`, the config `slipway.config.json`.
2. **Distribution.** A plugin repository that is its own marketplace, pinned by version in each consumer. Public under MIT, like spec-kit, OpenSpec and the other frameworks of this kind.
3. **CI per lane** (§4.6). A `CI: on | at-ship | off` header line, the default from the config, asked at scope.
4. **Where a step's narrative goes** (§4.3). The commit body in a fixed template, posted as one pull request comment per step; no append-only notes file.
5. **Where a step's decisions and owed items go** (§4.3). `docs/plan/<n>.decisions.md`, editable, one line each, marked at ship, checked by `docs-check`.
6. **History files.** None; the pull request is the lane's story.
7. **Default of `build`.** All remaining steps; `--one` for a single.
8. **Reviewers' model.** Opus, high effort.
9. **Product-specific builder agents.** Folded into the conventions skills the builder preloads; the plugin ships one `step-builder`.
10. **Tags.** `<prefix>-D<n>` with a one-line message by default; a `release` block for a repository that is a published artefact, this one first.
11. **The plugin's own framework.** Plain Claude Code with the built-in `/ship` until the plugin can run itself (§9).
12. **The ledger** (§4.7). Three files from the start; generated from plan headers at v0.2.

## 9. Roadmap

The repository works in two stages, because the plugin cannot run itself before it exists.

**v0.1 — the simplified process, built from this document.** The plugin is written from the design, not extracted from another repository; the method's first home is reference reading only, for what each step does in practice and which edge cases its tests guard. It is built under plain Claude Code, because it cannot run itself before it exists: conventional commits on short branches, the built-in `/ship` to commit, open the pull request and watch it, `/code-review` on the diff. The gate is `node --test` and `claude plugin validate . --strict`, in a workflow that runs in seconds, so CI is simply on. Releases are semver tags. The content is §4 directly: the six commands — `plan`, `scope`, `build`, `ship`, `adr`, `init` — under their byte ceilings (§4.1); the agents of §3.2 with models by role (§6); lanes from branches (§4.2); the narrative in commit bodies and the decisions file (§4.3); `build` on Claude Code's primitives (§4.4); `ship` in nine steps with `release` (§4.5); `CI:` per lane (§4.6); the three-file ledger (§4.7); the scripts behind `slipway` and the config schema; the repository as its own marketplace; and the two spikes of §11 first. Done when `claude plugin validate . --strict` and `node --test` are green; when one throwaway deliverable in a scratch repository is taken through `/slipway:init`, `plan`, `scope`, `build` and `ship` end to end, once with `forge: none` and once with `forge: github` on a private scratch repository; and when `/slipway:init --brownfield` has run on this repository with the config below in place. Tag `v0.1.0`.

**v0.2 — measured, developed with the plugin itself.** From the end of v0.1 every change to this repository is a lane run on the plugin (`claude --plugin-dir .` loads the working copy). Two changes make v0.2. The ledger table is **generated from the plan files' headers**, with `docs-check` refusing it stale (§4.7's end state), so the ledger stops being a merge surface and a branch-first `scope` is conflict-free. And the ceilings come down to measured figures: the first lanes on v0.1 record their steps' wall time, the builder's token use and `slipway report`'s fixed load; the numbers go in the changelog, and the ceilings of §4.1 and §7 are lowered to what was measured. Done when a deliverable of this repository is scoped, built and shipped with the generated table and `slipway report` prints a step's fixed load under 40 KB; tag `v0.2.0`.

Three kinds of consumer prove §12's claims: this repository, from the end of v0.1; the method's first home, the first brownfield consumer, when it adopts Slipway by §13.5; and a new repository of the operator's own, the second greenfield case.

This repository's own config, the simplest consumer there is and the reference example in the README:

```json
{
  "version": 1,
  "defaultBranch": "main",
  "forge": "github",
  "docs": {
    "records": "docs/adr",
    "plans": "docs/plan",
    "digests": "docs/rules",
    "specs": null
  },
  "lane": { "branch": "lane/D{n}", "worktree": "../{repo}-D{n}" },
  "commands": {
    "check": "node --test",
    "step-check": "node --test",
    "gate": "node --test && claude plugin validate . --strict"
  },
  "ci": { "default": "on", "workflow": "test.yml", "main": "on" },
  "merge": "merge-commit",
  "release": {
    "tag": "v{version}",
    "versionFile": ".claude-plugin/plugin.json",
    "also": [".claude-plugin/marketplace.json"]
  },
  "areas": {
    "skills": { "paths": ["skills/**"] },
    "agents": { "paths": ["agents/**"] },
    "scripts": { "paths": ["scripts/**", "bin/**"] }
  }
}
```

No lane setup, no lock (one worktree at a time is enough here), `CI: on` because a run costs seconds, and a `release` block so that a shipped deliverable is a plugin version. Its records are few — the process record as the first, then one per decision that would be expensive to reverse: the config schema, the forge adapter's four verbs, the commit-body template.

Two things to know about dogfooding. A skill edited mid-session keeps its old text until the next invocation after `/reload-plugins`, and an agent definition likewise — a nuisance, not a hazard, and also how a skill that reads badly in practice gets caught. And a lane here may touch the very skill that is running it; the rule is that a lane takes the new skills only when it reloads them, and finishes its current step under the old.

## 10. Risks

- **A plugin is one more repository to version.** Mitigated by pinning: a consumer takes a new process version on purpose, at a lane boundary.
- **Fewer machine checks on lanes.** Two lanes amending one record is a warning the operator can ignore. Accepted knowingly: lanes are chosen by the operator from the roadmap, and record disjointness has never been the thing that failed.
- **Narrative in commit bodies cannot be corrected.** A wrong sentence in a commit stays; a correction is one more commit or a pull request comment. Only text that never changes state goes there; everything that does lives in the editable decisions file.
- **A pull request comment is the forge's, not git's.** The step comments go if the repository moves hosts. The commit bodies and the decisions file carry the same facts in the tree, so nothing load-bearing depends on the comments.
- **`CI: off` lanes merge without a remote proof.** Accepted knowingly; the ship comment says so in so many words, and `ci.main` keeps the default branch's own pushes proved where the repository pays for it.
- **`context: fork` and `skills:` preloading are recent features.** Declare the minimum in `plugin.json`'s `engines.claude-code` and have `init` check `claude --version`, since enforcement of `engines` is not documented.
- **Each clone installs the plugin by hand once.** A committed `enabledPlugins` entry does not download anything; a collaborator who skips the README's setup line sees the process commands missing. Accepted: it is one command, and `init` writes it into the README.
- **The plugin's cache path changes per version.** Nothing in a consumer may hard-code it; the skills use `${CLAUDE_PLUGIN_ROOT}` and the Bash tool uses `bin/slipway` on `PATH`.

## 11. Stack-agnostic

The test applied to every mechanism: **would a Python service with pytest and GitLab, a Rust crate with cargo and no forge, or a Rails app on GitHub adopt it without editing the plugin?** Each row is an assumption the method carried in its first home and what Slipway does about it.

| Assumption | Slipway's answer |
| --- | --- |
| One package manager as the way to run anything | **Config.** Commands come from `slipway.config.json`; skills say `slipway run <name>`; the plugin's own verbs are `slipway <verb>`. |
| A build system's cache as the proof, and its graph to find what a change reaches | **Split.** The plugin computes changed paths from the proved tree; the repository's `step-check` command decides what they reach. The rule becomes "a cached result is a proof; nothing bypasses the cache", true of any cached runner or of none. |
| A test runner's "related files" mode | **The repository's.** A stack without one names its whole test command and runs more than it reaches. |
| A database per lane, created by a repository script | **`lane.setup`**, a repository command run once per lane worktree with `SLIPWAY_LANE` and `SLIPWAY_BRANCH`; the plugin knows nothing about databases. |
| A lock around the heavy commands across worktrees | **Config.** A file lock in the git common directory, cross-platform; which commands take it is `locks`. A repository with one worktree lists none. |
| A formatter run over generated files before a byte-for-byte comparison | **`commands.format`**, optional, run after generation and before the comparison. No formatter: the generator's own output is compared. |
| `gh` for pull requests and runs; one CI workflow by name | **The forge adapter** with four verbs; `ci.workflow` names the workflow; `none` ships without a pull request. GitLab is a later adapter. |
| `[skip ci]` to spend no CI minutes | **Neutral with a caveat.** Honoured by GitHub Actions, GitLab CI, Azure Pipelines, CircleCI, Buildkite; not by Jenkins without a plugin. |
| `main` as the default branch | **`defaultBranch`.** |
| `docs/adr`, `docs/plan`, `docs/rules`, `docs/specs` | **`docs` paths**, with those as defaults; `specs` may be `null`. |
| The record format: status and date lines, Context, Decision, Consequences, Alternatives, Rules | **The plugin's convention, deliberately.** It is the method, not the stack. A brownfield corpus in another format (MADR, Nygard) is read as records without rules until a lane touches one and adds `## Rules`. |
| Bundle size budgets | **The repository's gate.** The plugin never names them. |
| Monorepo areas and a digest per area | **Optional.** `areas` absent means one digest and one rule loader. |
| Conventional commits with a templated body; a merge commit at ship, never squash | **The plugin's convention.** `merge: merge-commit \| squash` is configurable; with `squash` the step commits vanish from the default branch, so the narrative then lives in the pull request comments and the decisions file only, and the skill says so. |
| Node to run the scripts | **The one runtime requirement.** Node 20 or later, no packages. Claude Code's native installer does not need Node, so a machine may lack it; `slipway` says so plainly and `init` checks. No fallback: the ledger and digests are not maintained by hand. |
| Windows: line endings, process trees, shells | **Exec-form hooks** (`node` with `args`, no shell); the runner spawns through the platform shell; no `sh -c` in any skill. LF normalisation is the repository's `.gitattributes`. |
| Byte budgets for governed files | **Defaults for the plugin's own files and the ledger**; a repository adds its own entries. |
| Behaviour specs with `Proved by:` test paths | **Optional.** The check is file existence; off when `docs.specs` is `null`. |
| Agents that know one product's layering | **The repository's.** `step-builder` preloads whatever skills the area names. |

What remains opinionated, and should: the method itself. Records with an amendment window, one-page plans whose done-whens are commands, one bounded review per step, decisions asked at scope and provisional in a step, a branch and a pull request per deliverable. A team that does not want those does not want this plugin; a team that does can run it on any stack that can name one command that proves its tree.

Two things only a live run settles, and v0.1 spikes first: whether a `bin/slipway` shim without a file extension runs on Windows under the Bash tool's Git Bash (the docs say `.cmd` and `.bat` shims cannot be spawned in exec form, which is a different path), and how `${CLAUDE_PLUGIN_ROOT}` behaves in a skill that is forked into a subagent.

## 12. Greenfield or brownfield?

**Greenfield gets the whole method on day one; brownfield gets the loop on day one and grows the records by touch.** Both work; the difference is where the value shows up.

| Dimension | Greenfield | Brownfield |
| --- | --- | --- |
| The record corpus | Starts with the process record and grows one decision at a time, each accepted at the step that builds it. Digests are small and complete. | Decisions exist, unrecorded. `init --brownfield` writes the process record and an empty ledger, adopts an existing ADR folder if one exists (read as records without `## Rules`), and `scope` writes an **as-built record** for a decision in force only when a lane touches its area. Digests start thin and fill where work happens. |
| The gate | Named at `init`; the first deliverable is the walking skeleton that makes `check` and `gate` mean something. | Often no single command proves the tree. `init` requires `check` and accepts a `gate` equal to it; the first deliverable is usually "the gate" itself. |
| Branching and merging | Lanes and draft pull requests from the first commit. | Most teams already branch and open pull requests, so the lane shape fits. Two frictions: a **squash-merge policy** (set `merge: squash`, lose step commits on the default branch, rely on the decisions file and comments) and a **required-check protection** that `CI: at-ship` would block (§4.6). |
| Conventions the builder preloads | Written as the stack is chosen; one skill per area. | None exist. The builder works from the code. A conventions skill is cut from the first review findings that repeat — "we keep telling it X" is the signal to write one. |
| Context budgets | Enforced from the start. | Existing documentation may be far over any ceiling. `init` records current sizes as the ceilings ("no worse than today") and the first process lane lowers them. |
| Behaviour specs | Written with each capability. | Optional (`docs.specs: null`), or written for a capability when a lane changes its behaviour. Retrofitting specs for everything is not a deliverable worth having. |
| Risk | Over-recording: a young project writing records for choices it will reverse in a week. The amendment window and ~80-line records are the mitigation. | Under-recording: lanes that ship without a record because "it was already like that". The as-built record on touch is the mitigation; the reviewer's finding for an unrecorded operator-class decision is the backstop. |

Where each is the better fit: a **new repository of the operator's own** is the ideal case and the one the plugin is tuned for first. A **brownfield repository the operator controls** works with `init --brownfield` and the record-on-touch rule, and gains most from `build` and `ship` before it gains from records. A **brownfield repository the operator does not control** — a squash-only policy nobody will change, Jenkins ignoring `[skip ci]`, no permission to add `docs/` — is the case to decline: the loop runs, but half the method is switched off and the plugin's value is mostly the build loop, which Claude Code's own primitives give nearly for free.

## 13. The repository, the development loop, publishing

Everything below is from the Claude Code plugin documentation as read on 2026-11-26; the items a live run must still verify are marked. The machine this starts on runs Claude Code 2.1.318.

### 13.1 Layout

```
slipway/                             the repository; also its own marketplace
  .claude-plugin/
    plugin.json                      { "name": "slipway", "version": "0.1.0", "description": …,
                                       "engines": { "claude-code": ">=2.1.323" } }
    marketplace.json                 { "name": "slipway", "owner": { "name": "machxi-dev" },
                                       "plugins": [ { "name": "slipway", "source": "./", "version": "0.1.0" } ] }
  skills/{plan,scope,build,ship,adr,init}/SKILL.md
  agents/{step-builder,code-reviewer,adr-reviewer,security-reviewer,adr-author,gate-runner}.md
  hooks/hooks.json                   SessionStart → node ${CLAUDE_PLUGIN_ROOT}/scripts/orient.mjs (exec form)
  bin/slipway                        the command runner and the plugin's verbs, on the Bash tool's PATH
  scripts/*.mjs, scripts/*.test.mjs  dependency-free Node 20; `node --test`
  templates/                         ledger.md, roadmap.md, shipped.md, record.md, process-record.md, plan.md,
                                     decisions.md, slipway.config.json, rules-loader.md, settings-fragment.json
  docs/design.md                     this document; docs/spikes/ the two spikes' outcomes
  README.md  CHANGELOG.md  LICENSE
  .github/workflows/test.yml         node --test, `claude plugin validate .` --strict
```

Facts that shaped it: `plugin.json`'s `name` namespaces every component (`/slipway:scope`). A marketplace entry's `source: "./"` points at the repository root, so one repository is plugin and marketplace at once. `engines.claude-code` exists from v2.1.323 as a declared minimum; enforcement is not documented, so `init` also checks `claude --version` itself. A `CLAUDE.md` at the plugin root is **not** loaded as context, so the one always-on sentence lives in the consuming repository's `CLAUDE.md`, written by `init`. `${CLAUDE_PLUGIN_ROOT}` is substituted inline in skill, agent and hook text but is **not** in the Bash tool's environment, which is why the runner is a `bin/` executable rather than a path the skill asks Claude to type. Hooks in exec form (`"command": "node", "args": […]`) spawn without a shell and behave the same on Windows and Unix.

### 13.2 Local development loop

```powershell
claude --plugin-dir ..\slipway
```

loads the working copy for one session without installing; `/reload-plugins` picks up edits. `claude plugin validate ..\slipway --strict` checks the manifest and every skill's and agent's frontmatter, and runs in CI. The scripts are tested with `node --test` against temporary git repositories.

### 13.3 Publishing

1. Tag the repository `v0.1.0`; set the same string in `plugin.json`'s `version` and the marketplace entry. The version string is what pins consumers: they stay on it until the author changes it. From the end of v0.1 the ship does this through the `release` block.
2. Consumers' `git` credentials are what clone the marketplace; a public repository needs none. SSH is tried first for the `owner/repo` form and HTTPS otherwise.
3. Releases are commits that bump `version` and the changelog; a consumer moves by `claude plugin update slipway@slipway`. Auto-update is **off by default** for a third-party marketplace, which is what a process plugin wants: a repository takes a new process version at a lane boundary, on purpose.

### 13.4 Consuming repository setup, what `init` does and what each clone does

Once per repository (the operator, or `/slipway:init` in a repository that already has the plugin loaded with `--plugin-dir`):

```powershell
claude plugin marketplace add machxi-dev/slipway --scope project
```

```powershell
claude plugin install slipway@slipway --scope project
```

The first writes `extraKnownMarketplaces.slipway` into `.claude/settings.json`; the second writes `enabledPlugins["slipway@slipway"]: true` beside it. Both are committed. To pin the marketplace itself to a tag or commit, add `ref` (or a full `sha`, v2.1.324+) under the marketplace's `source`. Then `/slipway:init` writes `slipway.config.json`, the ledger's three files with the tag prefix, the docs folders, the `.claude/rules/` loaders, the `CLAUDE.md` sentence and the budget file; `init --brownfield` additionally adopts an existing records folder and sets the ceilings at current sizes (§12).

Once per clone (every collaborator, every new machine): project-level `enabledPlugins` turns the plugin on but **does not download it** — the person runs the install command once, and until then `/plugin`'s Errors tab says "isn't installed here". `init` writes this into the repository's README under "Setup". Marketplaces declared in project settings are cloned at session start only after the folder is trusted.

### 13.5 Adopting Slipway in a repository that already runs the method

A repository that already runs the method on its own skills, agents and scripts takes the brownfield path of §12, as one lane with no behaviour change:

1. The two install commands of §13.4, the committed settings, the `CLAUDE.md` sentence and the README's setup line.
2. `slipway.config.json` with today's commands verbatim. The repository's own step check and lane setup become its `step-check` and `lane.setup` commands, and the team's usual commands still work.
3. The rule lines move into each record's `## Rules` section (§5.2) as a data step: each line of the hand-kept digests goes to the record it cites, and the repository proves the move with its own word tie — the words of every rule line before the move are the words after it.
4. `slipway digest` generates the digests from those sections, and the generated files replace the hand-kept ones.
5. `/slipway:init --brownfield` writes the three-file ledger from the existing one: the `planned` and `in progress` rows to `README.md`, the shipped rows to `SHIPPED.md`, the build plan to `ROADMAP.md`.
6. The consolidated process record (§5.1) supersedes the repository's chain of process records, whole.
7. The old process skills, agents and scripts are deleted; the repository's `.claude/README.md` shrinks to what is repository-specific; its budget file loses the entries for files that left.
8. Done when the six commands run there beside Claude's own `/ship`, which is untouched, and that lane is the first shipped with `/slipway:ship`.

## 14. Cases the first home's scripts guard

Reading the method's first home for v0.1 turned up cases its scripts and tests guard that the sections above do not mention. Each is listed with what Slipway does about it, so that none is dropped silently. "Kept" means the named script guards it and a test proves it; "declined" says why not.

**The lock** (`run`, §3.3):

- Two waiters that read the same dead holder must not both take over: the slower one would remove the faster one's live lock. Kept: a waiter takes over only under a claim it creates atomically beside the lock, re-reads the holder under the claim, and clears a claim left by a waiter that died holding it after a grace period.
- A runner killed by a signal it cannot catch (`SIGKILL`; on Windows nearly every stop) leaves its command running outside the lock, and the next waiter sees a dead holder. Kept, more simply than a watching process: the lock names the shell's process as well as the runner's, and is stale only when both are gone.
- A command that calls `slipway run` for a lock its own tree holds, the bounded wait read from the environment and refused when it is not a number, a held lock never deleted by a session: kept, as built.
- Windows reuses process ids, so a dead holder's id may name a live stranger. Declined: the lock then reads as live and the wait times out naming the holder; the operator removes it. Rare, and visible.

**The proved tree** (`proved-tree`, §3.3):

- The record is the worktree's own, in its git directory, never in the repository or the common directory; another worktree's proof is not this one's.
- Untracked files count as changed; ignored files do not.
- A record whose head is no longer an ancestor of `HEAD`, or whose tree git no longer has, is ignored rather than trusted: rewritten history proves nothing.
- With no usable record, the base is the merge base of `HEAD` with the remote's default branch where it exists, else the local one. `--base <ref>` overrides both. The first line of the output names the base and why.
- A red run records nothing; only the repository's `step-check` exiting zero moves the record.

**Digests** (`rules-digest`, §5.2):

- A rule's `(with: …)` naming a record that does not exist or is not `accepted` is refused, and so is an `(areas: …)` naming an area the config does not have. A line with no `(areas: …)` joins the general digest; a line may join several.
- Supersession by a delta. The first home kept a delta-superseded parent's rule lines in force "as carried by" the successor, which took a parser for which references in a status line are successors and which are prose. Declined: in Slipway only `accepted` records contribute lines, and a successor that leaves some of a parent's rules standing carries those lines in its own `## Rules` with `(with: <parent>)`. The parent's body stays untouched; the generator reads one status.
- An accepted record with no rule line was refused there. Declined as a refusal, since not every record governs code; the `adr-reviewer` reports an accepted record that governs code and has no `## Rules`.
- The 120-word cap was grandfathered for older records by number. Kept by diff instead of by number or date: `docs-check` refuses an over-long line only in a record the current branch adds or changes against the default branch, so a brownfield move (§13.5 step 3) carries old lines as they are.
- Committed digests that differ from the generator's output, after `commands.format`, are refused: kept, as §3.3 says.

**The ledger, plans and decisions** (`docs-check`, §4.3, §4.7):

- A ledger without its tag line, a row whose plan link does not resolve, a plan without the header lines `scope` writes: refused.
- A ledger table that differs from what the plans' headers and the roadmap's planned entries generate: refused as stale. A row with no source: refused, never dropped by the generator.
- A step titled as a close-out, or one whose done-when is the definition of done: refused in plans that are not `shipped`, so a brownfield corpus's history is read as it is.
- Decisions-file lines are read by shape: `Provisional (D<n>.<step>):` and `Owed (D<n>.<step>):` open, closed by `Ratified YYYY-MM-DD`, `Overturned YYYY-MM-DD, …` `Paid D<m>.<step>` or `Carried YYYY-MM-DD to D<m>`. A `shipped` plan with an open line is refused naming the file and line; a line in no known shape is refused rather than read as closed.
- Relative links: the first home checked every relative link in every Markdown file, with care for code fences, angle-bracket targets and percent escapes. Declined beyond the links `docs-check` already parses (ledger rows, `Records:` lines, digest citations, `Proved by:` paths); a general link checker is the repository's own.
- Files are listed with `git ls-files`, so a lane worktree inside the repository, or anything untracked or ignored, is never walked.
- Line endings stay the repository's `.gitattributes` (§11); `docs-check` reads CRLF and LF alike and does not police them.
- Specs: a `## Requirement:` has at least one `### Scenario:` with a WHEN and a THEN line and a `Proved by:` line whose backticked paths exist. Off when `docs.specs` is `null`.

**Budgets** (`docs-check`, §7): the budget file is `slipway.budget.json` beside the config, an object from a path or a glob to a ceiling in bytes. A path entry wins over a glob; where two globs match, the lower ceiling holds; an entry that matches no file, and an entry that is not a positive whole number, are refused, so a ceiling cannot outlive the file it guarded.

**Lane worktrees** (`lane-worktree`, §4.2): a file the `lane.copy` list names and the checkout lacks is skipped and named; one the worktree already has is left alone; contents are never printed. A worktree already at the path on the lane's branch is reused; one on another branch is refused. The branch is checked out where it exists and cut from the current head where it does not.

**Build and ship** (§4.4, §4.5):

- A lane on a branch the `lane.branch` pattern does not match, as a cloud session's given branch: the plan's `- Branch:` line names it, and `build` and `ship` find the lane from that line when the pattern finds none.
- A session that may not push to the default branch: the scoping commit rides as the lane branch's first commit and reaches the default branch with the pull request, which `scope` says, and which is safe only while no other lane is open.
- Reading the last run before a step (`CI: on`): a run cancelled by a later push is superseded, not failed; a run still going is left to the next step; no run because the pull request conflicts means merging the default branch in first; a run that cannot be read is said in the commit body and caught at the ship.
- A flake is the repository's step check's word, not the plugin's: what it calls one goes in `Flakes:` and is not a failure.
- `ship`: a tag that already exists stops the ship (a tag is never moved, nothing is ever forced); with a forge the merge commit is fetched and its second parent checked against the lane's head before it is tagged; the annotation is written from a file, verbatim; the gate runs in the background with no timeout of its own.

## Sources

- The review of the method's first two months (2026-11-26, three rounds), from which this document was distilled on 2026-11-27.
- Claude Code documentation on skills, sub-agents, plugins (create, loading, install, manifest reference, marketplace reference, CLI reference, components), hooks, model configuration and the `/ship` command, fetched 2026-11-26.
- spec-kit and OpenSpec, for the namespace and the registry-less ledger they chose.
