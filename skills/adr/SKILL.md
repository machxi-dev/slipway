---
name: adr
description: Write a new record, supersede one, or accept a proposed one at the head of the step that builds on it.
argument-hint: "<title or topic> | accept <n>"
disable-model-invocation: true
---

# Record: $ARGUMENTS

Governed by the design's §2, §5 and §14, and by the repository's process record. Run `slipway config` once to learn the records folder (`docs.records`) and the plans folder (`docs.plans`).

## Accept: `accept <n>`

1. Run `slipway adr accept <n>`. It marks the record `accepted`, marks each record its `- Supersedes:` line links `superseded by` it, updates the index, and prints the files it changed. It refuses a record that is not `proposed`, and a parent that is missing or already superseded.
2. For each parent it superseded, check that the successor's `## Rules` carries every rule line of the parent that stays in force, with `(with: <parent>)` added. A line it dropped by mistake is restored in the successor now.
3. Run `slipway digest`, then `slipway docs-check`. Report the files changed; they belong in the step's commit, not a commit of their own.

## Write or supersede: `<title or topic>`

1. **Read** the records index (`<records>/README.md`) and every record the topic touches. The process record states the method; do not restate it.
2. **The decision is the operator's to state.** If the decision and its reasons are not explicit in the conversation or the plan, ask in one message: what forces it, what was declined and why, what it will constrain later. Never invent a decision.
3. **Amend, or write a new record.** A record may be amended in place only while a plan in `<plans>/` whose `- Records:` line names it is `in progress`; label the change `Amended YYYY-MM-DD (D<n>.<step>).` at the paragraph it changes, and stop here. Otherwise a change to a frozen record is a new record that supersedes it.
4. **Make the file**: `slipway adr new "<title>"`, adding `--supersedes <n>[,<n>]` for each record it replaces. It prints the new file's path; the file is `proposed`, numbered after the highest, and listed in the index.
5. **Write it**, about eighty lines:
   - **Context**: the forces, and why now.
   - **Decision**: imperative, with concrete shapes where they decide something — a file layout, a table sketch, a signature.
   - **Consequences**: what gets easier, what gets harder, what is now owed.
   - **Alternatives**: each declined option and the reason in a line.
   - **Rules**, when the record governs code: one list item per rule, `- **Topic.** The rule. (with: <ids>) (areas: <slugs>)`. A rule is at most 120 words and says what to do, not why. `(areas: …)` names areas from `slipway.config.json`; leave it off for a rule that holds everywhere. Leave the section empty for a record that governs no code.
   - Altitude: decisions and the constraints behind them. No counts, no exhaustive lists, no universal negatives — they go stale and each one is a claim a reviewer must check. Where a fact must hold, state it as a predicate and let a test prove it.
6. **Superseding.** The successor states the delta: what changes and why, and for each part of the parent left standing, one line saying it stands as written. It carries each surviving rule line of the parent in its own `## Rules` with `(with: <parent>)`. The parent's body is never edited; its status changes when the successor is accepted.
7. **Status.** A record stays `proposed` until the step that builds on it starts: `/slipway:build` accepts it at that step's head. A record of a decision already in force, with nothing left to build, is accepted now, as above.
8. **The plan.** If a lane is open for this work, add the record to its plan's `- Records:` line as a link.
9. **Report** the path and three lines: the decision, what it supersedes, and what it constrains. Inside `/slipway:scope` the scope's commit carries the record; on its own, offer the commit `docs(adr): <number> <title>`.

Never: edit a digest by hand; edit an accepted record outside its window; accept a record before the step that builds on it; write a record for a choice that is cheap to reverse.
