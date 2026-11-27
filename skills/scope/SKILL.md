---
name: scope
description: Scope a planned deliverable into a one-page plan and its proposed records, after asking the operator's decisions in one batch, and on the operator's yes open its lane — branch, worktree, draft pull request.
argument-hint: "[D<n>]"
disable-model-invocation: true
---

# Scope $ARGUMENTS

The design's §4.1, §4.2 and §4.6, and the repository's process record. A conversation, not a fan-out: read, list the decisions, ask the operator's once, write. Run `slipway config` first for the docs paths, `forge`, `ci.default` and `release`.

1. **The row.** Read `<plans>/README.md`. The argument names the deliverable; a bare call takes the first `planned` row. No `planned` row: offer `/slipway:plan` and stop. A named row that is not `planned`, or whose `<plans>/D<n>.md` already exists, is not rescoped: say so and stop. Read that row's entry in `<plans>/ROADMAP.md` (that entry only), the records it names, and the code it touches. Open every file you make a claim about; never assert a count or a "nothing else does X" you have not just read.
2. **The decisions, asked once.** List what the plan depends on. A decision is the operator's when overturning it later would take a migration, a change a client already consumes, a weaker security behaviour, a new runtime dependency or an environment variable, or it is on the repository's "ask before" list; everything else is the builder's, and a builder's decision is written down only where steps would otherwise guess. Put every operator's decision to the operator **in one message**, each with its options and your recommendation, and always these:
   - `CI:` for this lane — `on`, `at-ship` or `off`, recommending `ci.default` (only `off` under `forge: none`);
   - `Release:` — `patch`, `minor` or `major` — when the config has a `release` block.
   Wait for the answers. No instruction waives the batch. Ask only what the code cannot answer.
3. **Uncertain mechanics** ("would this actually work?") get a timeboxed throwaway spike in a scratch worktree, offered to the operator, not a debate; its answer is one sentence in the plan.
4. **Records.** One `proposed` record per decision that will be expensive to reverse, written as `/slipway:adr` says (the `adr-author` agent may write it, given the decision and its reasons). Supersede by delta; never edit an accepted record outside its window.
5. **The plan**, `<plans>/D<n>.md`, from `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`:
   - header: `- Status: planned`, `- Records:` linking every record it writes, supersedes or amends, `- CI:`, `- Branch:` (`lane.branch` with the number, in backticks, or the branch this session was given), `- Release:` when asked, and `- Migrations: yes` when it adds them;
   - the goal in two or three sentences; constraints, each citing its record;
   - `## Done when`: the definition of done the ship runs — `slipway run gate` green, and whatever else must be proved whole;
   - steps, each one commit one builder holds whole and one reviewer reads as one diff: `- [ ] Built`, `- Done when:` each a plain command, one to a call, or a test name (a negative check, "no file says X", becomes a test), `- Records:`, `- Paths:` as globs, and `- Parts:` only when parts share no file. Every step builds: no close-out step and no documents-only step; what a close-out would carry goes in the last step's done-when or is the ship's;
   - `## Asked at scope`: each answer, and what was declined.
   Write `<plans>/D<n>.decisions.md` from `${CLAUDE_PLUGIN_ROOT}/templates/decisions.md`, with the number filled in.
6. **Check.** `slipway ledger set D<n> planned` regenerates the ledger's table, which now takes the row from the plan. `slipway docs-check` must pass. `slipway lane D<n> --overlap` prints any open lane that names the same record or also adds migrations.
7. **Commit on the default branch**, by explicit path, documents only: `docs(plan): scope D<n> — <title>`, and push it when there is a remote. Where the session may not push the default branch (a cloud session given its own branch), make this commit and step 8's on that branch instead, after `git merge --ff-only origin/<default>`, and say so: they reach the default branch with the pull request, which is safe only while no other lane is open.
8. **Offer to open the lane** — the operator's decision — naming any overlap warning from step 6. On yes:
   - `slipway ledger set D<n> "in progress"` (it prints each file it wrote: the ledger and the plan); `slipway docs-check`; commit those files, `docs(plan): open D<n>`, where step 7 committed, and push it when there is a remote.
   - `slipway worktree D<n>` cuts the lane branch from the default branch beside the repository, copies `lane.copy` and runs `lane.setup`; it prints the worktree's path. A cloud session on its own branch skips this and runs `lane.setup` (from `slipway config`) in its checkout itself, naming any `lane.copy` file it lacks.
   - Push the lane branch when there is a remote: `git -C <worktree> push -u origin <branch>`. Then write a body naming the plan's path and its `CI:` value to a file outside the repository, and `slipway forge pr-open --branch <branch> --title "D<n> — <title>" --body-file <file>`. A lane with no commit of its own yet gets no pull request (a forge refuses an empty one): `/slipway:build` opens it with the first step; say so. Under `forge: none` there is no pull request.
9. **Report**: the plan's path, the records written, the decisions and their answers, the overlap warnings, and — when opened — the worktree and the pull request, with the next move: start a session in the worktree and run `/slipway:build`.

Never: write the plan or open the lane before the operator answers; open a lane unasked; write a done-when a machine cannot run; put counts or exhaustive lists in a plan or a record.
