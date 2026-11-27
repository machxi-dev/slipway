# 0002. The process

- Status: proposed
- Date: 2026-11-27
- Supersedes: [0001](0001-the-process.md)

## Context

The first lane run with Slipway on Slipway (D1, pull request #23) found three places where record 0001 did not match how a lane actually runs.

- 0001 says a step is one commit, but the build loop sends confirmed review findings back to the builder, which pushes a follow-up commit. So every reviewed step with findings broke the rule as written.
- The ship ran `slipway run check` before its commit and then `slipway run gate` on that same commit. The gate includes the check, so the tree was proved twice and the ship waited for both.
- Plan and scope commit on the default branch and push it. Where a ruleset protects that branch, as it does on this repository, the push is refused, and the commit is left on a local default branch that can never reach origin.

This record restates the process with those three changes. The rest of 0001 stands.

## Decision

**What changes.**

- **A step's commits.** A step is one commit, plus at most one follow-up commit, `fix(<scope>): D<n>.<k> review findings`, that fixes its review's confirmed findings. A merge of the default branch that the builder makes before building, and a fix-forward at the ship, are their own commits and belong to no step. The step commit carries the trailers. The findings commit names the findings it fixes.
- **One proof at the ship.** Before the ship commit, the ship runs `slipway docs-check` and no other command. Then `slipway run gate`, under the lock on that commit, is the ship's one proof, along with the CI run on the same head where the lane's `CI:` asks for one.
- **Branch-first.** Nothing is committed on the default branch except the ship's merge.
  - `/slipway:scope` cuts the lane branch from the default branch before it writes, and commits and pushes the plan, its decisions file and its `proposed` records there. Opening the lane then moves its row to `in progress` on that same branch and opens the draft pull request. A plan whose lane is not yet opened lives on its pushed lane branch.
  - `/slipway:plan` commits its rows on the lane branch of the first row it adds, which that row's scope then takes up.
  - A planned or open row reaches the default branch with its lane's merge. So `plan` picks the next number, and the overlap warning finds open lanes, from the default branch and from the lane branches on the remote together.
- **The process template.** `templates/process-record.md`, the record `/slipway:init` writes into a new repository, states the process as this record does. A repository already on the plugin takes this record by superseding its own process record at a lane boundary.

**What stands as written in 0001**: the six commands; a lane as a branch, a worktree and a draft pull request; records, and where their rules live; plans; how a step is built and proved; one review per step, never by its builder; the narrative in commits and the state in the decisions file; whose a decision is; CI per lane; budgets. The rest of the ship stands too: one stop, merging the default branch in, one evidence comment, the merge commit, the tag, and removing the branch and worktree.

## Consequences

- A repository whose default branch is protected runs every command with no special case. A repository whose default branch is not protected runs the same way, so there is one path to test.
- The ledger table on the default branch lists only rows that have shipped or were merged with a lane. A session that wants the open lanes reads the lane branches too, which `slipway lane --overlap` and `plan`'s numbering do.
- If the operator declines to open a lane after its scope, the lane branch stays on the remote holding the plan until the lane is opened or the branch is deleted.
- The ship is one gate shorter.

## Alternatives

- A docs branch and its own pull request for each plan or scope: declined. It costs the operator a merge before every lane, to show rows that the lane's own pull request already shows.
- Committing on the default branch, with a fallback to the session's branch when the session knows it may not push: declined. A session cannot know before the push is refused, and the fallback is a second path.
- Allowing any number of follow-up commits per step: declined. There is one review and no second round, so there is one findings commit.

## Rules

- **Commands.** Run the repository's commands as `slipway run <name>` with the names in `slipway.config.json`, never by their tool's own name; a cached result is a proof, and nothing bypasses the cache. (with: 0001)
- **Records.** Amend a record in place only while a plan naming it in `- Records:` is `in progress`; otherwise supersede it, and carry the parent's surviving rule lines into the successor's `## Rules`. (with: 0001)
- **Digests.** Never edit a digest by hand: change the record's `## Rules` and run `slipway digest`. (with: 0001)
- **Decisions.** A decision is the operator's when overturning it later would take a migration, a change a client already consumes, a weaker security behaviour or a new runtime dependency. Scope asks them in one batch; a step takes one the plan did not settle provisionally, writes its line in the decisions file, and goes on. (with: 0001)
- **Review.** A step is reviewed once, in a fresh context, by a reviewer that did not build it; confirmed findings go back to the builder, and there is no second round. (with: 0001)
- **Commits.** A step is one commit on the lane branch whose body has `Built:`, `Step check:`, `Review:`, `Flakes:` and `Time:`, plus at most one `fix(<scope>): D<n>.<k> review findings` commit for its review's confirmed findings; never force-push a lane branch, and never commit to the default branch from a step. (with: 0001)
- **Branch-first.** Plan and scope commit on a lane branch, never on the default branch; only the ship's merge reaches it.
- **Ship.** A lane closes with `/slipway:ship`, never with Claude Code's own `/ship`; nothing merges to the default branch before it. Its one proof is `slipway run gate` on the ship commit, with CI where the lane's `CI:` asks. (with: 0001)
