---
name: ship
description: Close a built lane — the one stop on its decisions, the records, ledger and version, the gate under the lock and CI where the lane has it, the pull request merged with a merge commit, the tag, and the branch and worktree removed.
argument-hint: "[D<n>]"
disable-model-invocation: true
---

# Ship $ARGUMENTS

The design's §4.5, §4.6 and §4.7, and the repository's process record. Nine steps; the operator is stopped once, at step 3. Run `slipway config` for `forge`, `merge` and `release`.

1. **The lane.** `slipway lane` (with `D<n>` when given) prints the status, `CI:`, branch, plan, decisions file, worktree and steps. Stop unless the status is `in progress`, the worktree exists with the lane's branch checked out, and every step is built; name what is not. `slipway forge comments` should hold a `D<n>.<k> reviewed:` line for every step; a step without one is owed its review: stop and point to `/slipway:build`. Run every command below in the worktree.
2. **Merge the default branch in**: `git fetch origin` (with a remote), `git merge origin/<default>` (or `<default>`). A conflict in a digest is resolved by `slipway digest`; in the ledger, by keeping both sides' rows; anything else by reading both sides. Commit the merge.
3. **The one stop.** In one message: every open line of the decisions file (`Provisional`, `Owed`) with the step's choice and what overturning costs, and every item of the plan's `## Done when` a machine cannot run (a browser walk, a deployment), as a checklist. Wait for every answer. Then mark each decisions line, editing the line in place: `Ratified YYYY-MM-DD`, `Overturned YYYY-MM-DD, <what replaces it>`, or an owed one `Paid D<n>.<k>` when this lane paid it. An overturned line is fixed forward now: dispatch `slipway:step-builder` with the line and the answer, as its Findings section says, and read its commit.
4. **The ship commit.**
   - `slipway adr accept <n>` for each record the plan's `Records:` line names that is still `proposed`; then `slipway digest`.
   - With a `release` block: `slipway release bump <part>`, the part from the plan's `- Release:` line.
   - `slipway ledger ship D<n> --pr <url>` (the url from `slipway forge pr`; none under `forge: none`) moves the row to `SHIPPED.md` with today's date and marks the plan `shipped`.
   - One changelog line, where the repository keeps a changelog, in its own style.
   - `slipway docs-check` passes; then have `slipway:gate-runner` run `check`.
   - Commit by explicit path, `chore(ship): D<n> — <title>`, body naming the decisions marked and the records accepted; end it with `[skip ci]` **only** when `CI: off`. Push.
5. **The gate**, on that commit: `slipway:gate-runner` runs `gate` (it runs it in the background, under the lock). Also run the other machine items of the definition of done. A failure in what the lane reaches: fix forward through `slipway:step-builder`, then run the gate again. A failure only outside the lane's reach: say so and ask. With `CI: on` or `at-ship`, after the gate has ended: `slipway forge run --sha <head> --wait --log`; red is fixed forward the same way, and the gate runs again on the new head. Never merge without a green gate on the head that merges.
6. **One comment** to a file outside the repository, then `slipway forge comment --body-file <file>`: each command run, its counts and duration, the machine (`node -p "process.platform+' '+process.arch"` and its Node version), and the CI run's result and link, or that the lane ran with `CI: off`.
7. **Merge.** Note the lane head, `git rev-parse HEAD`. `slipway forge ready`, then `slipway forge merge`. Where the permission layer refuses either, give the operator both commands and continue when they say merged. Under `forge: none` the merge is local, `--no-ff`, into the default branch where the main checkout has it, and pushed.
8. **Tag**: `slipway tag D<n> --head <lane head> --pr <url> --title "<title>"`, or `--commit <sha>` instead of `--head` when the config's `merge` is `squash`. The name is `<tagPrefix>-D<n>`, or the release tag of the bumped version. A tag that already exists stops the ship: a tag is never moved.
9. **Clean up**, from the main checkout (`git worktree list`, first line): bring its default branch up to date with `git pull --ff-only` where it tracks one, then `slipway worktree remove D<n>`. Report the merge commit, the tag, the gate's counts, the CI run, and the decisions marked. Fewer than two `planned` rows left in the ledger: offer `/slipway:plan`; otherwise `/slipway:scope`.

Never: merge on a red or missing gate; mark a decisions line the operator has not answered; force anything, move a tag, or skip a hook; run the gate in this context.
