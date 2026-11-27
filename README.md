# Slipway

Slipway is a [Claude Code](https://claude.com/claude-code) plugin that gives a repository a **scope → build → ship** workflow:

- **Decisions as records.** Each decision that would be expensive to reverse is written down, proposed at scope and accepted at the step that builds it.
- **One-page plans.** A deliverable's plan fits on a page, and its done-whens are commands and test names, not prose.
- **One review per step.** Every step is built in a fresh agent and reviewed once, in another fresh context, never by its builder.
- **A branch and a pull request per deliverable.** Each deliverable runs on its own branch and worktree, and ships with a gate that machines run and a merge commit.

The plugin owns the process and stays out of your stack: it never calls a build tool by name. You tell it your commands once in `slipway.config.json`, and it runs them with `slipway run <name>`. The same plugin is meant to serve a pnpm monorepo, a Python service, a Rust crate or a Rails app.

The documentation is at **[machxi-dev.github.io/slipway](https://machxi-dev.github.io/slipway/)**.

> **Status: early development.** The six commands below work today, with the `slipway` runner behind them, with GitHub as the forge or with none. Slipway's own changes are built with it. The process can still change between minor versions; [the changelog](CHANGELOG.md) says what each one added and changed.

## Commands

Every command lives in the `slipway` namespace, so none of them collides with Claude Code's own (`/ship` stays Claude's).

| Command | What it does |
| --- | --- |
| `/slipway:plan` | Turn a goal or a finding into rows in the ledger. |
| `/slipway:scope` | Write a deliverable's one-page plan and records, ask your decisions in one batch, and open its branch. |
| `/slipway:build` | Build the plan's steps, each in a forked builder agent, each reviewed once. |
| `/slipway:ship` | Close the deliverable: one stop for your decisions, the gate, the merge, the tag. |
| `/slipway:adr` | Write, supersede or accept a decision record. |
| `/slipway:init` | Make a repository ready for Slipway. |

## Requirements

- Claude Code 2.1.323 or later.
- Node.js 20 or later on your `PATH`. Slipway's scripts use only Node's standard library and install nothing.
- Git.

## Install

In the repository you want to use it in, run both commands once. They write two lines to `.claude/settings.json`, which you commit:

```sh
claude plugin marketplace add machxi-dev/slipway --scope project
claude plugin install slipway@slipway --scope project
```

Then, in Claude Code, run `/slipway:init`.

Every other clone of that repository runs the second command once. The committed settings turn the plugin on but do not download it.

## Developing Slipway

```sh
git worktree add --detach ../slipway-plugin origin/main     # once: the copy of the plugin that Claude Code loads
claude --plugin-dir ../slipway-plugin                       # load it for one session
node --test                                                 # the scripts' tests
claude plugin validate . --strict                           # the manifests and every skill's and agent's frontmatter
```

Claude Code loads the plugin from a separate worktree of `main`, not from the copy you edit. It treats every file under a `--plugin-dir` path as sensitive and refuses edits to it, so a session that loaded this working copy could not change it. Refresh that worktree between lanes, so the next lane runs on what the last one shipped:

```sh
git fetch origin && git -C ../slipway-plugin checkout --detach origin/main
```

Then start a new session, or run `/reload-plugins` in the one you have.

[docs/design.md](docs/design.md) is the design the first versions build to. Changes are conventional commits on short branches, and CI runs both checks above on every pull request.

## License

[MIT](LICENSE)
