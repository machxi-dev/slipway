---
name: scope
description: Scope a planned deliverable into a one-page plan and its proposed records, after asking the operator's decisions in one batch, and on the operator's yes open its lane — branch, worktree, draft pull request.
argument-hint: "[D<n>]"
disable-model-invocation: true
---

# Scope $ARGUMENTS

The design's §4.1, §4.2 and §4.6, and the repository's process record. A conversation, not a fan-out: read, list the decisions, ask the operator's once, write. Run `slipway config` first for the docs paths, `forge`, `ci.default` and `release`.

1. **The row.** `git fetch origin` with a remote. Read `<plans>/README.md`, here and on each lane branch on the remote, which holds rows not yet merged: `git branch -r --list "origin/<lane.branch prefix>*"`, then `git show origin/<branch>:<plans>/README.md`. The argument names the deliverable; a bare call takes the first `planned` row. No `planned` row: offer `/slipway:plan` and stop. A named row that is not `planned` is not rescoped: say so and stop. One whose `<plans>/D<n>.md` exists, here or on its branch, is only offered for opening: steps 4 and 9. Read that row's entry in `<plans>/ROADMAP.md`, from the branch that holds the row (that entry only), the records it names, and the code it touches. Open every file you make a claim about; never assert a count or a "nothing else does X" you have not just read.
2. **The decisions, asked once.** List what the plan depends on. A decision is the operator's when overturning it later would take a migration, a change a client already consumes, a weaker security behaviour, a new runtime dependency or an environment variable, or it is on the repository's "ask before" list; everything else is the builder's, and a builder's decision is written down only where steps would otherwise guess. Put every operator's decision to the operator **in one message**, each with its options and your recommendation, and always these:
   - `CI:` for this lane — `on`, `at-ship` or `off`, recommending `ci.default` (only `off` under `forge: none`);
   - `Release:` — `patch`, `minor` or `major` — when the config has a `release` block.
   Wait for the answers. No instruction waives the batch. Ask only what the code cannot answer.
3. **Uncertain mechanics** ("would this actually work?") get a timeboxed throwaway spike in a scratch worktree, offered to the operator, not a debate; its answer is one sentence in the plan.
4. **The lane branch, before anything is written.** It is `lane.branch` with the number, or the branch this session was given. A branch already on the remote (a `/slipway:plan` commit cut it): `git switch <branch>`, then `git merge origin/<default>`. A row that is only on another lane branch (a later row of a plan batch): cut from that one, `git switch -c <branch> --no-track origin/<its branch>`. Otherwise `git switch -c <branch> --no-track origin/<default>` (`<default>` with no remote). A session given its own branch is on it: merge `origin/<default>` in. Everything below is written and committed on this branch; nothing is committed on the default branch.
5. **Records.** One `proposed` record per decision that will be expensive to reverse, written as `/slipway:adr` says (the `adr-author` agent may write it, given the decision and its reasons). Supersede by delta; never edit an accepted record outside its window.
6. **The plan**, `<plans>/D<n>.md`, from `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`:
   - header: `- Status: planned`, `- Records:` linking every record it writes, supersedes or amends, `- CI:`, `- Branch:` (step 4's, in backticks), `- Release:` when asked, and `- Migrations: yes` when it adds them;
   - the goal in two or three sentences; constraints, each citing its record;
   - `## Done when`: the definition of done the ship runs — `slipway run gate` green, and whatever else must be proved whole;
   - steps, each one commit one builder holds whole and one reviewer reads as one diff: `- [ ] Built`, `- Done when:` each a plain command, one to a call, or a test name (a negative check, "no file says X", becomes a test), `- Records:`, `- Paths:` as globs, and `- Parts:` only when parts share no file. Every step builds: no close-out step and no documents-only step; what a close-out would carry goes in the last step's done-when or is the ship's;
   - `## Asked at scope`: each answer, and what was declined.
   Write `<plans>/D<n>.decisions.md` from `${CLAUDE_PLUGIN_ROOT}/templates/decisions.md`, with the number filled in.
7. **Check.** `slipway ledger set D<n> planned` regenerates the ledger's table, which now takes the row from the plan. `slipway docs-check` must pass. `slipway lane D<n> --overlap` prints any open lane that names the same record or also adds migrations.
8. **Commit on the lane branch**, by explicit path, documents only: `docs(plan): scope D<n> — <title>`; with a remote, `git push -u origin <branch>`. The plan, its decisions file and its records reach the default branch with the lane's merge.
9. **Offer to open the lane** — the operator's decision — naming any overlap warning from step 7. On yes:
   - `slipway ledger set D<n> "in progress"` (it prints each file it wrote: the ledger and the plan); `slipway docs-check`; commit those files on the lane branch, `docs(plan): open D<n>`, and push it when there is a remote.
   - `slipway forge pr-open --branch <branch> --plan <plans>/D<n>.md`: the draft opens on the scope's commits, titled `D<n> — <title>`, its body the plan's goal, step titles and `CI:` line. Under `forge: none` there is no pull request.
   - `git switch <default>`, then `slipway worktree D<n>`: the worktree on the lane branch beside the repository, `lane.copy` copied and `lane.setup` run; it prints the worktree's path. A session given its own branch stays on it and runs `lane.setup` (from `slipway config`) in its checkout itself, naming any `lane.copy` file it lacks.
   On no: `git switch <default>`; the lane branch stays on the remote, holding the plan, until the lane is opened or the branch is deleted.
10. **Report**: the plan's path, the records written, the decisions and their answers, the overlap warnings, and — when opened — the worktree and the pull request, with the next move: start a session in the worktree and run `/slipway:build`.

Never: commit on the default branch; write the plan or open the lane before the operator answers; open a lane unasked; write a done-when a machine cannot run; put counts or exhaustive lists in a plan or a record.
