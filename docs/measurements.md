# Measurements

What a step costs in context, measured on real lanes for v0.2 (design §7, §9), and how to measure it again.

## Summary

- **A step builder's fixed load measured 7.7–8.2 KB** across four steps in two lanes — about a fifth of the 40 KB target, and about 3k tokens.
- **Text costs about 2.5 bytes a token, not four.** The design's 40 KB is therefore about 16k tokens, not 10k.
- **Every area's digest was loaded in every session.** Claude Code reads a rule file's `@` imports at session start even when the rule has `paths:`. Only the loader's own text waited for a file in the area. Area loaders now carry their digest inline (§5.2), and the second lane shows the digest loading only on a matching read.
- **Claude Code's own load is the larger part.** A subagent with the builder's tools starts at about 12k tokens before any Slipway text. About 5k of that is the session's skill listing, which comes with the `Skill` tool.
- **The ceilings come down** to what keeps a step reaching one area under 40 KB even with every file at its ceiling. The general digest goes from 12 KB to 8 KB and an area digest from 32 KB to 12 KB. Each skill and agent gets its measured size, rounded up to 512 bytes, as its ceiling.

## The runs

The runs used Claude Code 2.1.332 in a Linux container, with the plugin loaded from the working copy (`claude -p --plugin-dir`). They ran on a copy of [slipway-scratch](https://github.com/machxi-dev/slipway-scratch), pushed as its `measure/v0.2` branch. The copy differs from the scratch repository in four ways:

- `forge: none`, because this container cannot reach GitHub's GraphQL API, which `gh pr` needs.
- `CI: off`.
- A `calc` area over `src/**` and `test/**`, with a 539-byte conventions skill.
- The plugin from `--plugin-dir` instead of the marketplace.

Each deliverable went through `/slipway:plan`, `/slipway:scope`, `/slipway:build` and `/slipway:ship` headless. A resumed session gave the operator's answers. Every proposal was taken as recommended, except that both lanes asked for two steps.

- **D2, multiply and divide.** It wrote record 0002 and ran on the v0.1 loaders, which import the area digest.
- **D3, a command-line entry point.** It wrote record 0003 and ran on the inline loaders. Its reviews found five issues across the two steps, and the builders fixed them.

| Run | Wall time | Cost |
| --- | --- | --- |
| `plan` (D2 and D3 rows) | 44 s | $0.34 |
| `scope D2`: questions, then the lane | 23 s + 50 s | $0.27 + $0.56 |
| `build` D2, two steps | 129 s | $0.94 |
| `ship` D2 | 60 s | $0.44 |
| `scope D3`: questions, then the lane | 41 s + 49 s | $0.36 + $0.58 |
| `build` D3, two steps, five findings fixed | 332 s | $2.27 |
| `ship` D3: stopped for one provisional line, then ratified | 13 s + 54 s | $0.21 + $0.54 |

## Per step

Context is the tokens an API call sent: input, cache writes and cache reads. *First* is the builder's first call, before it has read anything. *Peak* is its largest call.

| Step | Fixed load (`slipway report`) | Builder: first / peak context | Calls | Output tokens | Builder wall time | Review |
| --- | --- | --- | --- | --- | --- | --- |
| D2.1 multiply | 7,709 B | 16,362 / 24,502 | 13 | 4,116 | 36 s | code: clean |
| D2.2 divide | 8,044 B | 16,362 / 23,779 | 13 | 4,139 | 37 s | code, records: clean |
| D3.1 CLI success paths | 8,066 B | 16,237 / 32,975 | 19 | 8,414 | 143 s | code, records: 2 findings |
| D3.2 CLI refusals | 8,163 B | 16,237 / 34,390 | 13 | 10,245 | 147 s | code, security: 3 findings |

The reviewers started at 7.5–7.8k tokens and peaked at 11–21k. They have no `Skill` tool, so they get no skill listing. The orchestrators' sessions started at about 46k tokens and peaked at 52–75k. Of that, 40.7k is the cloud session's own system prompt (control below), so those figures say little about Slipway.

`slipway report D2.2` on the D2 lane, on the v0.1 loaders:

```
always on      2,727
                   316  CLAUDE.md
                   152  .claude/rules/slipway.md
                 1,808  docs/rules/general.md
                   451  docs/rules/calc.md
procedure      3,656
                 3,656  step-builder (agent body)
the step         973
                   973  slipway lane --step 2
area rules       149
                   149  .claude/rules/slipway-calc.md
conventions      539
                   539  .claude/skills/calc-conventions/SKILL.md

total: 8,044 bytes (7.9 KB, ≈ 3,218 tokens), under the 40.0 KB target
```

On the inline loaders (D3), `docs/rules/calc.md` leaves *always on*. The 451-byte loader is counted under *area rules*, and only for a step whose paths reach `src/**` or `test/**`.

## What Claude Code loads, checked against the transcripts

A subagent's transcript (`~/.claude/projects/<cwd>/<session>/subagents/agent-*.jsonl`) records what Claude Code put in its context. The `instructions` attachment holds the memory files at start, `nested_memory` holds the rules loaded on a matching read, and `skill_listing` holds the skill listing. `slipway report` counts the same files:

- **At start:** `CLAUDE.md` with its HTML comments removed (294 of 316 bytes), `.claude/rules/slipway.md` and the general digest it imports. On D2 this also included `docs/rules/calc.md`, imported by the area's path-scoped loader. On D3 it did not.
- **On the first read of a matching file:** the area loader's text, with its frontmatter removed and its imports not expanded. That was 149 bytes on D2, only the `@` line, and 451 bytes on D3, the digest itself.
- **The agent's body** is its system prompt: 3,641 characters of the 3,656 bytes `report` counts.
- **The step:** the output of `slipway lane --step`, 876–1,241 characters.
- **The conventions skill:** its body, plus a one-line base-directory header.

## Bytes to tokens

The calibration used three control runs of a subagent with the builder's tools, in an empty repository:

| Control | First-call context | Difference |
| --- | --- | --- |
| Body "Reply with the single word ok." | 12,067 | Claude Code's own load |
| The `step-builder` body | 13,358 | +1,291 tokens for 3,656 bytes: 2.8 bytes a token |
| The D2 lane's memory files (2,919 bytes, as rendered) | 13,315 | +1,248 tokens: about 2.3 bytes a token with Claude Code's wrapper text |

`slipway report` estimates tokens at 2.5 bytes each. The builder's real first call, 16,362 tokens, is the control's 12,067 plus about 4.3k. The body and memory account for about 2.5k of that. The remaining 1.8k is Claude Code's own: a longer environment block in a worktree and the permission mode the run used. It is not Slipway text.

Claude Code's 12k is outside Slipway's control. About 20k characters of it, roughly 5k tokens, is the skill listing of the plugins installed in this container. It comes with the builder's `Skill` tool, so it will differ on another machine.

## Ceilings

The fixed parts are measured. The parts a repository grows are given what remains of 40 KB, for a step whose paths reach one area:

| Part | Measured | Ceiling | Where it is held |
| --- | --- | --- | --- |
| `CLAUDE.md` | 0.3 KB (Slipway's block) | 4 KB | `slipway.budget.json` |
| `.claude/rules/slipway.md` | 0.15 KB | 1 KB | `slipway.budget.json` |
| General digest | 1.8 KB (the process record's 7 rules) | 12 → **8 KB** | `slipway.budget.json` |
| Area digest, inline in its loader | 0.2–0.45 KB | 32 → **12 KB** (loader 13 KB) | `slipway.budget.json` |
| `step-builder` body | 3.6 KB (file 3,964 B) | 4 KB | the plugin's tests |
| The step: plan header and section | 0.9–1.2 KB | about 4 KB, allotted | `slipway report` |
| Conventions skills | 0.5 KB | about 6 KB, allotted | `slipway report` |
| **Total** | **7.7–8.2 KB** | **≤ 40 KB** | `slipway report --check` |

The skills and agents are held at their measured size rounded up to 512 bytes:

| File | Size | Ceiling |
| --- | --- | --- |
| `plan` | 2,539 | 3,072 |
| `scope` | 5,775 | 6,144 |
| `build` | 5,375 | 6,144 → 5,632 |
| `ship` | 5,724 | 6,144 |
| `adr` | 4,112 | 6,144 → 4,608 |
| `init` | 4,584 | 6,144 → 5,120 |
| `step-builder` | 3,964 | 4,096 |
| Each other agent | 1,451–2,342 | 6,144 → 1,536–2,560 |

## Seen on the way

These are not fixed in this change:

- **The builder pushes with no remote.** Under `forge: none` with no `origin`, the builder's push fails and the step reports it. That is harmless, but `step-builder` could skip the push when there is no remote.
- **One `Time:` line was off.** D3.1's said 14:16–14:21, but its builder reported its real end as about 14:18. The line was left alone, because the lane branch is never rewritten.
- **The skill listing costs the builder about 5k tokens**, because it holds the `Skill` tool to load conventions skills. Preloading them through the agent's `skills:` would drop the tool, but the conventions vary by area, so it needs one agent per area or a per-step mechanism.

## Measuring again

1. In a scratch repository, take a deliverable through `plan`, `scope`, `build` and `ship`. Headless runs work: `claude -p "/slipway:build" --plugin-dir <slipway> --permission-mode acceptEdits --allowedTools "…" --output-format json`.
2. For each step, run `slipway report D<n>.<k>`. Run it before the ship, while the plan is in the tree.
3. Run `node docs/measurements-transcripts.mjs ~/.claude/projects/<cwd>/<session>.jsonl` on the `build` session. It prints the session's calls, first and peak context, output tokens and wall time, then the same for each subagent, with the memory files loaded at start and on a matching read.
4. For Claude Code's own load, run a control agent with the builder's `tools:` and a one-line body in an empty repository, and compare first-call contexts.
