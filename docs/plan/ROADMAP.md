# Roadmap

The build plan: tracks, what each deliverable needs, the order, the candidates, and what blocks a stage. `/slipway:plan` writes it; `/slipway:scope` reads one entry when it cuts a plan; nothing else reads it.

## Tracks

- **Maintenance** — follow-ups left from shipped versions: stale docs, flaky tests. D1.
- **Dogfood fixes** — defects found by running lanes with slipway on slipway (D1, PR #23). D2, D3.

## Planned

<!-- One entry per planned row: "### D<n> — <title>", its one-line scope, what it needs, the records it will likely write or touch. -->

### D2 — Tool calls the permission layer allows, and the builder context counted

Skills and agents run one plain command per call, write with Write, change with Edit and grep with the Grep tool (ship step 8's $(git rev-parse) included); the gate-runner runs in the foreground instead of polling; the step-builder's skill listing is dropped or counted by slipway report.

- Findings: D1 run defects 1 (eleven refused Bash calls: `$( )`, `${ }`, groups, `echo "exit $?"`, `! grep`, redirects, `sed -i`), 3 (Skill tool puts a ~21 KB skill listing in the builder; §4.4 says `skills:` preload) and 4 (gate-runner polled a background gate with until/grep/sleep for ~75 s).
- Needs: nothing. step-builder.md is at 3,964 of its 4,096-byte ceiling.
- Records: none expected; design §4.4 and §7 if the builder's tools or the report change.

### D3 — Release, pull request and process record 0002

Release bump renames the changelog's Unreleased heading and the release title comes from one source; the lane pull request says what it delivers; record 0002 supersedes 0001 for follow-up commits, one proof at ship and protected default branches; ship's tag wording, worktree removal and default-branch update fixed.

- Findings: D1 run defects 2 (bump leaves `## Unreleased`), 5 (ship step 4's check duplicates the gate), 6 (rule "a step is one commit" vs the review-findings commit), 7 (PR body only "Plan / CI"), 8 (plan and scope push a ruleset-protected default branch); and from D1's finish: (a) on Windows `slipway worktree remove D<n>` run inside the worktree leaves the folder; (b) the ship says it tags the ship commit, but `slipway tag` tags the merge commit; (c) release title is the bare tag where v0.1.0 was "Slipway v0.1.0"; (d) step 9's `git -C <main checkout> pull --ff-only` fails when that checkout is on another branch: use `git fetch origin <default>:<default>`.
- Needs: D2 (both touch the ship skill).
- Records: supersedes 0001 — The process (as 0002); design §4.1, §4.5. Scope asks the operator where plan and scope commit when the default branch is protected (lane branch, branch-first per §4.7, or a docs branch with its own pull request).

## Candidates
