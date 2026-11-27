# Spike: `${CLAUDE_PLUGIN_ROOT}` in a skill with `context: fork`

Asked by docs/design.md §11. Run on 2026-11-27, Linux, in a cloud container, on Claude Code 2.1.323 (the declared minimum) and 2.1.332.

## Outcome

**The design holds.** In a skill forked into a subagent, `${CLAUDE_PLUGIN_ROOT}` behaves exactly as it does in an inline skill, and as §13.1 says:

1. **It is substituted inline in the skill text** before the subagent reads it. The subagent received the absolute plugin root, and the Bash commands it ran contained that path, not the variable.
2. **It is not in the Bash tool's environment**, forked or not. `$CLAUDE_PLUGIN_ROOT` expands to the empty string, and a script spawned from Bash does not see it either.
3. **The plugin's `bin/` is on the Bash tool's `PATH` inside the forked subagent too.** An extensionless Node script in `bin/` resolved by bare name and ran there.

The same results came from both versions. No change to docs/design.md follows.

For Slipway this means a forked skill such as `build` can say `slipway run <name>` and reach `bin/slipway` by name. A skill may also pass `${CLAUDE_PLUGIN_ROOT}/…` paths in its text, since they reach the subagent already resolved. A script must never read `CLAUDE_PLUGIN_ROOT` from its environment when Bash started it. `bin/slipway` should find its own root from its own path (`process.argv[1]`), which the probe shows is the absolute path inside the plugin.

## Fixture

`docs/spikes/fixtures/plugin-root-in-fork/` is a separate throwaway plugin named `spike`, so nothing of Slipway's own is involved:

- `skills/forked/SKILL.md`: `context: fork`, `agent: general-purpose`, `disable-model-invocation: true`.
- `skills/inline/SKILL.md`: the same body, with no `context` or `agent`.
- `bin/spike-probe`: an extensionless `#!/usr/bin/env node` script printing its own `argv[1]` and `CLAUDE_PLUGIN_ROOT` from its environment.

Each skill tells Claude to copy the line `TEXT=[${CLAUDE_PLUGIN_ROOT}]` verbatim, run `printf 'ENV=[%s]\n' "$CLAUDE_PLUGIN_ROOT"; command -v spike-probe; spike-probe`, and run `ls "${CLAUDE_PLUGIN_ROOT}/bin"`.

The parent session's own environment had no `CLAUDE_PLUGIN_ROOT`, so nothing was inherited.

## Commands and output

Run from an empty git repository standing in for a consumer, with `F` the fixture's absolute path:

```sh
claude -p "/spike:forked" --plugin-dir "$F" --allowedTools=Bash
claude -p "/spike:inline" --plugin-dir "$F" --allowedTools=Bash
```

### 2.1.323, `/spike:forked`

```
1. TEXT=[/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork]

2. Output of the first command:
```
ENV=[]
/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin/spike-probe
PROBE argv1=[/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin/spike-probe] env=[]
```

3. Output of `ls "/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin"`:
```
spike-probe
```

4. Running as a subagent: yes.
```

### 2.1.323, `/spike:inline`

```
1. TEXT=[/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork]

2. Output of the first command:

```
ENV=[]
/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin/spike-probe
PROBE argv1=[/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin/spike-probe] env=[]
```

3. Output of the ls command:

```
spike-probe
```

4. Subagent: no. I am running as the main session, not a subagent.

Summary: the plugin root path was substituted into the skill text, but the plugin root environment variable was empty in Bash. The probe script was on PATH anyway, so the fixture's bin directory reached the shell through PATH, not through the env var.
```

### 2.1.332, `/spike:forked`

```
1. TEXT=[/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork]

2. Output of the first Bash command:
```
ENV=[]
/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin/spike-probe
PROBE argv1=[/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin/spike-probe] env=[]
```

3. Output of `ls "/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin"`:
```
spike-probe
```

4. Running as a subagent: yes.
```

### 2.1.332, `/spike:inline`

```
1. TEXT=[/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork]

2. Output of the first command:

```
ENV=[]
/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin/spike-probe
PROBE argv1=[/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin/spike-probe] env=[]
```

3. Output of the `ls` command:

```
spike-probe
```

4. Subagent: no. I am the main session, not a subagent.

Recap: the plugin root environment variable was empty in the Bash shell, but the fixture's bin directory was on PATH, so the probe binary resolved and ran. The fixture skill invoked in the main session, not a fork.
```

### Proof the fork happened (2.1.323)

The subagent's own word ("Running as a subagent: yes") is not proof. The stream shows it instead. With `--output-format stream-json --verbose` added, every tool call of `/spike:forked` carries a parent tool-use id naming the forked command, and those of `/spike:inline` carry none. Each line below gives the tool name, the parent id and the tool input:

```
/spike:forked
Bash parent=forked-command-spike:forked {"command":"printf 'ENV=[%s]\\n' \"$CLAUDE_PLUGIN_ROOT\"; command -v spike-probe; spike-probe", …}
Bash parent=forked-command-spike:forked {"command":"ls \"/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin\"", …}

/spike:inline
Bash parent=null {"command":"printf 'ENV=[%s]\\n' \"$CLAUDE_PLUGIN_ROOT\"; command -v spike-probe; spike-probe", …}
Bash parent=null {"command":"ls \"/home/user/slipway/docs/spikes/fixtures/plugin-root-in-fork/bin\"", …}
```

The second call in each run is the substitution at work. The skill said `ls "${CLAUDE_PLUGIN_ROOT}/bin"`, and the forked subagent ran it with the absolute path already in place.

## Not covered

- The plugin was loaded with `--plugin-dir`. An installed plugin, run from its versioned cache path, was not tried. The mechanism is the same, but §10's cache-path risk is only covered by the rule this spike supports: never hard-code the path.
- Windows was not tried here. Its `bin/` question is the other spike, docs/spikes/bin-shim-windows.md.
