# Ledger

Tags: `v{version}`, the version in `.claude-plugin/plugin.json`, bumped by `/slipway:ship`.

The open lanes are the `in progress` rows.

## Window

1. A lane is a branch, a worktree and a draft pull request, made by `/slipway:scope` when the operator says yes.
2. A lane's environment is made once, by the repository's `lane.setup` command, from the branch name.
3. Commands listed under `locks` in `slipway.config.json` take one lock across all worktrees.
4. A record may be amended in place only while a plan that names it in its `Records:` line is `in progress`; otherwise it changes by supersession.

## Rows

`planned` rows whose plan is not yet written keep their one-line scope in [ROADMAP.md](ROADMAP.md); shipped rows move to [SHIPPED.md](SHIPPED.md).

| D | Title | Status |
| --- | --- | --- |
