---
name: build
description: Build a lane's unchecked steps — one step-builder agent per step, one bounded review after each, confirmed findings back to the same builder, one pull request comment per step.
argument-hint: "[D<n> | D<n>.<k>] [--one]"
disable-model-invocation: true
model: sonnet
effort: medium
---

# Build $ARGUMENTS

The design's §4.3, §4.4 and §4.6. You orchestrate: dispatch agents, read their short reports, decide continue or stop. You write no code and run no check, test or build in this context; the agents do.

1. **The lane.** Run `slipway lane` (with `D<n>` when given) in the lane's worktree. It prints the status, `CI:`, the branch, the plan, the decisions file, the worktree and the next step. Stop unless the status is `in progress` and the lane's branch is checked out here; name the worktree to start a session in. `D<n>.<k>` builds that one step; `--one` builds the next step only. Every step built: say so and point to `/slipway:ship`.
2. **Owed reviews first.** `slipway forge comments` prints a line `D<n>.<k> reviewed: …` for each step already reviewed. A ticked step with no such line — a run interrupted between build and review — gets its review (step 5) and its comment (step 6) before any new step is built. Its builder is gone: confirmed findings go to a new `slipway:step-builder`, given the step, the commit and the findings.
3. **Build one step.** The `Agent` tool, `subagent_type: slipway:step-builder`, in the foreground. The prompt: the worktree's path, `D<n>`, the step's number, and "build it as your instructions say" — nothing else from the plan; it reads its own section. Keep its agent id. Its report: the commit hash, the step check's last lines, the provisional lines it wrote, the part each changed path belongs to, or what blocks it.
   - Blocked, or on the repository's "ask before" list: stop (step 8).
   - A transient failure (a network error, a timeout, a refused push): one retry, by message to the same builder. A second failure stops.
4. **Check the commit**: `git show --stat --format=%B <hash>`. The body holds `Built:`, `Step check:`, `Review:`, `Flakes:` and `Time:`, and the commit ticks the step's box in the plan; otherwise the step is not closed, and you tell the builder so, once. `git diff <hash>~1 <hash> -- <decisions file>` shows the provisional lines it wrote.
5. **Review.** By what the diff touches, any of:
   - `slipway:code-reviewer` for code;
   - `slipway:adr-reviewer` when it writes, amends or accepts records, or builds mostly what a record governs;
   - `slipway:security-reviewer` when it touches authentication, sessions, authorisation, input handling, secrets, configuration or deployment.
   When the plan's step names `- Parts:`, one reviewer per part, given that part's paths. Launch them **together**, in one message, each given the worktree, the hash, the plan's path with the step's number, and the decisions file. A finding is confirmed when the lines it names say what it says; read those lines, not more. Drop what is wrong; keep an uncertain one for the builder to judge.
   Confirmed findings go **back to the same builder** by `SendMessage` to its agent id: it already holds the step, fixes them, re-runs the step check and pushes `fix(<scope>): D<n>.<k> review findings`. Read its hash. There is no second review.
6. **Comment.** Write to a file outside the repository: the first line `D<n>.<k> reviewed: clean` or `D<n>.<k> reviewed: <m> findings, fixed in <hash>`, a blank line, the step commit's message, then the findings commit's message when there is one. `slipway forge comment --body-file <file>`. Under `forge: none` the comment is kept in the worktree's git dir; either way the next run reads it in step 2.
7. **Next.** Unless `--one` or `D<n>.<k>`, back to step 3 with the next unchecked step. State is the plan's boxes, git and these comments, so the same command resumes an interrupted run.
8. **Report**, short: each step built — its hash, the review's outcome, the provisional lines written, any flakes — and, when it stopped early, where and why, with what the operator must decide. Every step built: the next move is `/slipway:ship`.

Under `CI: on` the builder reads the last run itself before it builds; you never wait for CI.

Never: run `slipway run`, a test or a build here; edit code, the plan or the decisions file yourself; build two steps at once; let a builder review its own diff; review a step twice; push or merge the default branch.
