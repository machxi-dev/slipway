---
name: plan
description: Turn a goal, a review or a finding into planned ledger rows and their roadmap entries — no plan file, no record numbers.
argument-hint: "<goal, review or finding>"
disable-model-invocation: true
---

# Plan: $ARGUMENTS

The design's §4.1 and §4.7. A conversation that ends in `planned` rows and nothing else. Run `slipway config` for the plans folder.

1. **Read**, after bringing the default branch up to date (`git pull --ff-only` where it tracks one, so the next number is the next one), `<plans>/README.md` (the open rows), `<plans>/ROADMAP.md` (tracks, order, candidates, what blocks a stage) and the last rows of `<plans>/SHIPPED.md`. Read what the argument points at: a review, a finding, an issue, the code it names. A rough edge noted in a decisions file, a pull request comment or a record's consequences is a candidate too.
2. **Cut deliverables.** Each one is a lane a scope can plan on one page: one line saying what it delivers, the track it belongs to, what it needs first (another row, a record, an outside change), and the records it will likely write or touch, by title. Split what would not fit one plan; merge what no one would ship alone. A row is not a step: no implementation in it.
3. **Agree them** with the operator in one message: the rows, their order, and what stays a candidate. Change what they say; ask only what you cannot settle by reading.
4. **Write**, on the lane branch of the first row, never on the default branch. `git fetch origin` with a remote, then `git switch -c <branch> --no-track origin/<default>` (`<default>` with no remote): `<branch>` is `lane.branch` (from `slipway config`) with the number that row will take, one past the highest the ledger, the roadmap and `SHIPPED.md` show. A session given its own branch writes on it. Then, for each agreed row in order: `slipway ledger add "<title>" --scope "<the one line>"`. It takes the next number, adds the entry under `## Planned` in the roadmap and regenerates the ledger's table, whose `planned` row that entry is until a plan is written: keep its `### D<n> — <title>` heading there. Then add to that entry, in the roadmap, what it needs and the records it touches, one line each; move a row's track or order there when it changed; put what stays a candidate under `## Candidates`, one line each. When the first `ledger add` prints another number, rename the branch to match: `git branch -m <its branch>`.
5. **Check and commit.** `slipway docs-check` passes. Commit by explicit path, `docs(plan): plan D<a>–D<b> — <theme>`; `git push -u origin <branch>` with a remote; then, where step 4 cut the branch, `git switch <default>`. Say that the rows reach the default branch with that lane, whose scope takes the branch up.
6. **Report** the rows and their numbers, and the next move: `/slipway:scope` takes the first `planned` row.

Never: commit on the default branch; write a plan file, a decisions file or a record; number a record; change a row that is `in progress`; renumber a row.
