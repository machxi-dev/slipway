---
title: Configuration
---

# Configuration

Slipway owns the process and stays out of your stack. Everything that depends on the stack is a command you name once in `slipway.config.json` at the repository's root; the plugin runs it as `slipway run <name>` and never calls a build tool by name. `/slipway:init` writes the file after asking you for the values it could not find, and `slipway config` prints it with every default filled in.

<!-- Written by hand. site/scripts/sync.mjs fails the build when this page does not name, in backticks, every key the schema in scripts/config.mjs knows. -->

## A small repository

Slipway's own config, the simplest consumer there is:

<<< ../../../slipway.config.json

## The keys

### Top level

| Key | Default | What it is |
| --- | --- | --- |
| `$schema` | none | Allowed, for an editor's JSON schema; Slipway ignores it. |
| `version` | required | Always `1`. |
| `defaultBranch` | `main` | The branch lanes are cut from and merged into. |
| `forge` | `github` | `github` opens draft pull requests, reads CI runs, comments and merges with `gh`. `none` has no pull request: the ship merges the lane locally with `--no-ff` and pushes. |
| `tagPrefix` | required unless `release` is set | A shipped deliverable is tagged `<tagPrefix>-D<n>`. |
| `merge` | `merge-commit` | `merge-commit` keeps every step's commit on the default branch. `squash` loses them there, so a lane's story lives in its pull request comments and decisions file only. |

### `docs`

Where the process keeps its documents. The four folders must differ.

| Key | Default | What it is |
| --- | --- | --- |
| `docs.records` | `docs/adr` | The decision records, numbered, with their status lines. |
| `docs.plans` | `docs/plan` | The ledger (`README.md`, `ROADMAP.md`, `SHIPPED.md`), each deliverable's one-page plan `D<n>.md` and its decisions file `D<n>.decisions.md`. |
| `docs.digests` | `docs/rules` | The rule digests `slipway digest` generates from the accepted records' `## Rules`. |
| `docs.specs` | `docs/specs` | Behaviour specs whose `Proved by:` paths `slipway docs-check` checks exist. `null` turns them off. |

### `lane`

A lane is a branch, a worktree and a draft pull request per deliverable.

| Key | Default | What it is |
| --- | --- | --- |
| `lane.branch` | `lane/D{n}` | The lane's branch name; `{n}` is the deliverable's number, exactly once. |
| `lane.worktree` | `../{repo}-D{n}` | Where the lane's worktree goes, relative to the repository; `{repo}` is its folder name. |
| `lane.copy` | `[]` | Untracked files to copy into a new worktree, such as `.env`. A file the checkout lacks is skipped and named; contents are never printed. |
| `lane.setup` | none | A command run once when a lane's worktree is made, with `SLIPWAY_LANE` (`d45`) and `SLIPWAY_BRANCH` set: a database per lane, a compose project, or nothing. |

### `commands`

Required. Each entry is a name — lower-case letters, digits and hyphens — and the shell line it runs, as the repository already writes it. Three names are required:

| Name | What it proves |
| --- | --- |
| `check` | The fast inner loop a builder runs while working. |
| `step-check` | What proves a step before its commit. It receives the paths changed since the tree last proved green in that worktree, in the file `SLIPWAY_CHANGED_PATHS` names, with `SLIPWAY_BASE` beside it. It may simply equal `check`. |
| `gate` | The whole tree, before a ship. Often the CI job's commands joined with `&&`. |

Two more are read when present: `format`, run over every generated file before it is compared byte for byte, and any name you list under `locks`. Any other name is yours to run with `slipway run <name>`.

### `locks`

| Key | Default | What it is |
| --- | --- | --- |
| `locks.tiers` | `[]` | Commands that take one lock across every worktree of the clone, so two lanes never run the heavy ones at once. Each must be a name under `commands`. |

### `ci`

CI is a per-lane setting: each plan's header carries `- CI: on | at-ship | off`, and these are the defaults.

| Key | Default | What it is |
| --- | --- | --- |
| `ci.default` | `on`, or `off` with `forge: none` | `on`: every step pushes and the next reads the run. `at-ship`: steps push with `[skip ci]` and the ship commit gets the one run. `off`: no run at all, the only value under `forge: none`. |
| `ci.workflow` | none | The workflow file whose runs a lane reads, such as `test.yml`. None: every workflow on the commit counts. |
| `ci.main` | `on` | Whether pushes to the default branch run CI, whatever a lane's value. |

### `release`

For a repository that is itself a published artefact. With `release` set, a ship bumps a semver version and tags it, instead of tagging `<tagPrefix>-D<n>`; under `forge: github` it also publishes a GitHub Release from the version's changelog section. `null` or absent turns it off.

| Key | Default | What it is |
| --- | --- | --- |
| `release.tag` | `v{version}` | The tag's name; must contain `{version}`. |
| `release.versionFile` | required | The file whose version the ship bumps: a JSON `"version"` (`package.json`, `plugin.json`), a `version = "…"` line (`Cargo.toml`, `pyproject.toml`), or a file holding the version alone. |
| `release.also` | `[]` | Other files that carry the same version, bumped with it. |

### `areas`

Optional. An area is a part of the repository with its own conventions and its own rule digest, loaded only when a session works on a file in it. Each key is the area's slug: lower-case letters, digits and hyphens, and not `general`, which is the digest for the whole repository.

| Key | Default | What it is |
| --- | --- | --- |
| `areas.<slug>.paths` | required | Globs for the area's files. |
| `areas.<slug>.skills` | `[]` | The repository's conventions skills a step builder preloads when the step's paths reach the area. |

## A monorepo

The design's example for a pnpm monorepo with a database per lane, a lock on the heavy commands and two areas:

```json
{
  "version": 1,
  "defaultBranch": "main",
  "forge": "github",
  "tagPrefix": "app",
  "docs": { "records": "docs/adr", "plans": "docs/plan", "digests": "docs/rules", "specs": "docs/specs" },
  "lane": {
    "branch": "lane/D{n}",
    "worktree": "../{repo}-D{n}",
    "copy": [".env"],
    "setup": "pnpm db:lane"
  },
  "commands": {
    "check": "pnpm check",
    "step-check": "pnpm step:check",
    "gate": "pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check",
    "format": "pnpm exec prettier --write"
  },
  "locks": { "tiers": ["step-check", "gate"] },
  "ci": { "default": "at-ship", "workflow": "gate.yml", "main": "on" },
  "release": null,
  "merge": "merge-commit",
  "areas": {
    "api-and-data": { "paths": ["apps/api/**", "packages/db/**"], "skills": ["api-conventions"] },
    "frontend": { "paths": ["apps/web/**", "packages/ui/**"], "skills": ["frontend-conventions"] }
  }
}
```

## Budgets

Beside the config, `slipway.budget.json` maps a path or a glob to a ceiling in bytes for every file a session is told to read: the ledger, the plans, the digests, the rule loaders. `slipway docs-check` refuses a file over its ceiling. A path entry wins over a glob, and where two globs match the lower ceiling holds. `init` writes the defaults; on a brownfield repository it records today's sizes as the ceilings, so the first check passes and later lanes lower them. [The design's §7](/reference/design#s7) says how the defaults were set.
