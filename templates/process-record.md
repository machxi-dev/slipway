# {{id}}. The process

- Status: {{status}}
- Date: {{date}}
- Supersedes: none

## Context

Work in this repository is cut into deliverables, each built on a branch of its own and closed by a ship. The method needs a few things to hold without anyone remembering them: decisions that would be expensive to reverse are written down before they freeze; a plan says what done means in commands rather than prose; every step is reviewed once by someone other than its builder; the operator is asked at the two ends of a lane and not in between; and the tree that merges is the tree a machine proved. The Slipway plugin carries the commands, agents and scripts; this record states the rules they follow, so a session wanting "the process" reads one record and its digest.

## Decision

**Six commands, typed by the operator.** `/slipway:plan` turns a goal or a finding into `planned` ledger rows. `/slipway:scope` writes a row's one-page plan and its `proposed` records on the lane's branch, after asking the operator's decisions in one batch, and on the operator's yes opens the lane. `/slipway:build` builds the lane's unchecked steps. `/slipway:ship` closes it. `/slipway:adr` writes, supersedes or accepts a record. `/slipway:init` makes a repository ready. Claude Code's own `/ship` stays as it is, for branches outside a lane.

**A lane is a branch, a worktree and a draft pull request.** The branch is named by `lane.branch` in `slipway.config.json`, and the lane is read from it; a branch the pattern does not match is a lane when an `in progress` plan's `- Branch:` line names it. The ledger's `in progress` rows, on the default branch and on the lane branches, are the open lanes. A lane's environment is made once, by the repository's `lane.setup` command, when its worktree is made. The commands listed under `locks.tiers` take one lock across every worktree of the clone.

**Branch-first.** Nothing is committed on the default branch except the ship's merge. `/slipway:scope` cuts the lane branch from the default branch before it writes, and commits and pushes the plan, its decisions file and its `proposed` records there; opening the lane moves its row to `in progress` on that branch and opens the draft pull request. `/slipway:plan` commits its rows on the lane branch of the first row it adds, which that row's scope takes up. A planned or open row reaches the default branch with its lane's merge, so the next number and the open lanes are read from the default branch and the lane branches on the remote together. A repository whose default branch is protected runs every command the same way.

**Records.** A record is `proposed` when scope writes it, `accepted` at the head of the step that builds on it, and `superseded by` a later record when it changes after it froze. A record may be amended in place only while a plan naming it in its `- Records:` line is `in progress`. A successor states what it changes and carries, in its own `## Rules`, every rule line of its parent that stays in force. Records state decisions and the constraints behind them, at about eighty lines: no counts, no exhaustive lists, no universal negatives.

**Rules live in the records.** A record that governs code ends with `## Rules`: one list item per rule, the topic in bold, at most 120 words, then `(with: …)` for other records it cites and `(areas: …)` for the digests it joins. `slipway digest` writes the digests in `{{digests}}` from the accepted records; nobody edits a digest by hand.

**Plans.** One page per deliverable in `{{plans}}`: a header with `- Status:`, `- Records:`, `- CI:` and `- Branch:`; done-whens that are commands and test names; steps cut as large as one builder can hold whole, each naming the records it reads and the paths it touches. No step is a close-out: what a close-out would carry goes in the last building step's done-when or is the ship's.

**Steps.** A step is built by a `step-builder` agent on the lane branch: orient on the step's own section of the plan, read the records it names, implement, run `slipway run check` while building, end on `slipway run step-check` green, tick the step, commit with the narrative in the body and push. A step is that commit, plus at most one `fix(<scope>): D<n>.<k> review findings` commit after its review; a merge of the default branch the builder makes before building, and a fix-forward at the ship, are their own commits and belong to no step. The step check is sized by the plugin from the last tree it proved green in that worktree. A cached result is a proof; nothing bypasses the cache.

**One review per step, never by its builder.** The orchestrator hands the step's diff to one reviewer in a fresh context: `adr-reviewer` for a step heavy in records, `security-reviewer` for authentication, sessions, configuration or deployment, `code-reviewer` otherwise; one reviewer per part, launched together, when the plan names parts that share no file. Confirmed findings go back to the same builder, which fixes them, re-runs the step check and pushes the step's one findings commit. There is no second round.

**Narrative in the commit, state in the decisions file.** A step's commit body has `Built:`, `Step check:`, `Review:`, `Flakes:` and `Time:`, its findings commit names the findings it fixes, and the same text is posted as one comment on the pull request. A provisional decision or an owed item is one line in `{{plans}}/D<n>.decisions.md`, which the ship marks.

**Whose a decision is.** The operator's when overturning it later would take a migration, a change a client already consumes, a weaker security behaviour or a new runtime dependency: a schema, a wire shape or status, a security behaviour, a dependency, an environment variable, and anything on the repository's "ask before" list. Everything else is the builder's. Scope asks the operator's in one batch before the plan is written; a step that meets one the plan did not settle takes the option it would recommend, writes a `Provisional` line, and goes on.

**The ship** is one stop and one gate: every step ticked; the default branch merged in; the decisions file's open lines and the operator's own items put in one batch and every line marked; digests regenerated, records `accepted`, the row moved to `SHIPPED.md`, one changelog line, `slipway docs-check` passing and no other check run, committed and pushed; `slipway run gate` under the lock on that commit, the ship's one proof, with the CI run on the same head where the lane's `CI:` asks for one; one comment with the evidence; the pull request merged with a merge commit; the tag; the branch and worktree removed.

**CI per lane.** The plan's `- CI:` line is `on`, `at-ship` or `off`. `at-ship` and `off` lanes push their steps with `[skip ci]`; an `at-ship` ship commit goes without it, so one run proves the merged tree.

**Budgets.** `slipway.budget.json` gives a byte ceiling for each file a session is told to read; `slipway docs-check` refuses a file over its ceiling, along with a ledger, plan, decisions file or record out of shape.

## Consequences

The process changes in one place, the plugin, and a repository takes a new version of it on purpose, by superseding this record at a lane boundary. A session's fixed load is this record's digest, the area digests for where it works, and the step's own section of the plan. The pull request's comments and the decisions file are a lane's story; there are no history files. Lanes are opened by the operator's judgement, with a warning when two would amend one record.

## Alternatives

- A chain of process records, each a delta on the last: declined, because a chain is read as a chain.
- A notes file per deliverable, appended by every step: declined; narrative that never changes goes in commit bodies, and what changes state goes in the small decisions file.
- Lane files and a generated window section: declined; the branch says which lane, and the `in progress` rows say which are open.

## Rules

- **Commands.** Run the repository's commands as `slipway run <name>` with the names in `slipway.config.json`, never by their tool's own name; a cached result is a proof, and nothing bypasses the cache.
- **Records.** Amend a record in place only while a plan naming it in `- Records:` is `in progress`; otherwise supersede it, and carry the parent's surviving rule lines into the successor's `## Rules`.
- **Digests.** Never edit a digest by hand: change the record's `## Rules` and run `slipway digest`.
- **Decisions.** A decision is the operator's when overturning it later would take a migration, a change a client already consumes, a weaker security behaviour or a new runtime dependency. Scope asks them in one batch; a step takes one the plan did not settle provisionally, writes its line in the decisions file, and goes on.
- **Review.** A step is reviewed once, in a fresh context, by a reviewer that did not build it; confirmed findings go back to the builder, and there is no second round.
- **Commits.** A step is one commit on the lane branch whose body has `Built:`, `Step check:`, `Review:`, `Flakes:` and `Time:`, plus at most one `fix(<scope>): D<n>.<k> review findings` commit for its review's confirmed findings; never force-push a lane branch, and never commit to the default branch from a step.
- **Branch-first.** Plan and scope commit on a lane branch, never on the default branch; only the ship's merge reaches it.
- **Ship.** A lane closes with `/slipway:ship`, never with Claude Code's own `/ship`; nothing merges to the default branch before it. Its one proof is `slipway run gate` on the ship commit, with CI where the lane's `CI:` asks.
