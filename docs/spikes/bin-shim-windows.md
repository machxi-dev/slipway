# Spike: an extensionless `bin/` shim on Windows under Git Bash

Asked by docs/design.md §11. Run on 2026-11-27 on Windows (`MINGW64_NT-10.0-26300`, Git for Windows' MSYS 3.5.4), Node v24.16.0, with Claude Code 2.1.332 (installed natively) and 2.1.323 (the declared minimum, through `npx`).

## Outcome

**The design holds.** When a plugin is loaded with `claude --plugin-dir`, Claude Code on Windows puts that plugin's `bin/` on the Bash tool's `PATH`. The Bash tool runs in Git Bash. A file in `bin/` that has no extension and starts with `#!/usr/bin/env node` is found by bare name and runs:

- `command -v shim-probe` resolves it, and `PATH` holds the plugin's `bin/` as an MSYS path (`/c/Users/…/bin`).
- Arguments arrive intact, including one quoted argument with a space in it (`"two words"`).
- The exit code comes back through: a probe exiting 3 gives `exit=3`.
- `process.argv[1]` is the script's **Windows** path (`C:\Users\…\bin\shim-probe`), not the MSYS one.

Both versions gave the same results. No change to docs/design.md follows.

For step 3 this means:

- **`bin/slipway` has no extension**, is LF-only and starts with a `#!/usr/bin/env node` shebang.
- **It finds the plugin root from `process.argv[1]`** with `node:path`, never by string-splitting on `/`, and never from `CLAUDE_PLUGIN_ROOT` (see docs/spikes/plugin-root-in-fork.md).
- **The executable bit doesn't matter on Windows.** The checkout had `core.fileMode=false` and still ran the file, because MSYS treats a file that starts with `#!` as executable. Git keeps the file at mode `100755` for Unix clones.
- **LF is what keeps the shebang working.** The machine has `core.autocrlf=true`, yet `.gitattributes` (`* text=auto eol=lf`) still checked the file out with LF (`i/lf w/lf`), and `od -c` shows no `\r` after `node`. A CRLF shebang would make `env` look for `node\r`.

## Fixture

`docs/spikes/fixtures/bin-shim-windows/` is a separate throwaway plugin named `shimspike`:

- `bin/shim-probe`: an extensionless `#!/usr/bin/env node` script that prints the platform, the Node version, `argv[1]` and its arguments, and exits with `SHIM_EXIT`.
- `skills/probe/SKILL.md`: `disable-model-invocation: true`. It tells Claude to run six commands, each as its own Bash call, and copy their output.
- `extract.mjs`: prints each Bash call and its raw tool result from a `stream-json` log. The results below come from that log, not from the model's retelling.

## Commands

On the Windows machine, in a clone of this repository:

```sh
git fetch origin spike/bin-shim-windows
git worktree add ../slipway-spike-shim FETCH_HEAD
git config --get core.autocrlf     # true
git config --get core.fileMode     # false
git ls-files --eol docs/spikes/fixtures/bin-shim-windows/bin/shim-probe   # in the worktree
# i/lf    w/lf    attr/text=auto eol=lf 	docs/spikes/fixtures/bin-shim-windows/bin/shim-probe
```

Then, from a fresh empty git repository in `%TEMP%`, with `FIX=C:/Users/<user>/code/slipway-spike-shim/docs/spikes/fixtures/bin-shim-windows`:

```sh
claude -p "/shimspike:probe" --plugin-dir "$FIX" --allowedTools=Bash --output-format stream-json --verbose < /dev/null > shim.jsonl 2>&1
node "$FIX/extract.mjs" shim.jsonl

npx -y @anthropic-ai/claude-code@2.1.323 -p "/shimspike:probe" --plugin-dir "$FIX" --allowedTools=Bash --output-format stream-json --verbose < /dev/null > shim-323.jsonl 2>&1
node "$FIX/extract.mjs" shim-323.jsonl
```

Both runs exited 0.

## Output

### 2.1.332

In this run the model sent commands 5 and 6 as parallel tool calls. `extract.mjs` prints each result where it appears in the stream, so command 5's output appears after command 6's `$` line, and command 5 shows an empty result. Both outputs are complete. The `Shell cwd was reset` lines are the Bash tool's own and are left out here.

```
# claude_code_version=2.1.332 cwd=C:\Users\smosk\AppData\Local\Temp\shimspike-BPOdew

$ [Bash] uname -a; echo "SHELL=$SHELL"; command -v bash node git
MINGW64_NT-10.0-26300 dev 3.5.4-cbe555e0.x86_64 2024-10-10 20:32 UTC x86_64 Msys
SHELL=/bin/bash.exe
/usr/bin/bash
/c/Program Files/nodejs/node
/mingw64/bin/git

$ [Bash] command -v shim-probe; echo "exit=$?"
/c/Users/smosk/code/slipway-spike-shim/docs/spikes/fixtures/bin-shim-windows/bin/shim-probe
exit=0

$ [Bash] shim-probe one "two words"; echo "exit=$?"
SHIM OK platform=win32 node=v24.16.0
argv1=C:\Users\smosk\code\slipway-spike-shim\docs\spikes\fixtures\bin-shim-windows\bin\shim-probe
args=["one","two words"]
exit=0

$ [Bash] SHIM_EXIT=3 shim-probe; echo "exit=$?"
SHIM OK platform=win32 node=v24.16.0
argv1=C:\Users\smosk\code\slipway-spike-shim\docs\spikes\fixtures\bin-shim-windows\bin\shim-probe
args=[]
exit=3

$ [Bash] ls -l "C:/Users/smosk/code/slipway-spike-shim/docs/spikes/fixtures/bin-shim-windows/bin"; head -c 120 "C:/Users/smosk/code/slipway-spike-shim/docs/spikes/fixtures/bin-shim-windows/bin/shim-probe" | od -c | head -3

$ [Bash] echo "$PATH" | tr ':' '\n' | grep -i shimspike -n || echo "no PATH entry mentions the fixture"; echo "$PATH" | tr ':' '\n' | grep -n bin-shim-windows || true
total 1
-rwxr-xr-x 1 smosk 197609 250 Nov 27 13:29 shim-probe
0000000   #   !   /   u   s   r   /   b   i   n   /   e   n   v       n
0000020   o   d   e  \n   c   o   n   s   o   l   e   .   l   o   g   (
0000040   `   S   H   I   M       O   K       p   l   a   t   f   o   r
no PATH entry mentions the fixture
51:/c/Users/smosk/code/slipway-spike-shim/docs/spikes/fixtures/bin-shim-windows/bin
```

### 2.1.323

In the last command, the `shimspike` match on line 10 is `npx`'s own `node_modules/.bin` entry. It matched only because the scratch directory happened to be named `shimspike-*`. The plugin's `bin/` is line 60.

```
# claude_code_version=2.1.323 cwd=C:\Users\smosk\AppData\Local\Temp\shimspike-BPOdew

$ [Bash] uname -a; echo "SHELL=$SHELL"; command -v bash node git
MINGW64_NT-10.0-26300 dev 3.5.4-cbe555e0.x86_64 2024-10-10 20:32 UTC x86_64 Msys
SHELL=/bin/bash.exe
/usr/bin/bash
/c/Program Files/nodejs/node
/mingw64/bin/git

$ [Bash] command -v shim-probe; echo "exit=$?"
/c/Users/smosk/code/slipway-spike-shim/docs/spikes/fixtures/bin-shim-windows/bin/shim-probe
exit=0

$ [Bash] shim-probe one "two words"; echo "exit=$?"
SHIM OK platform=win32 node=v24.16.0
argv1=C:\Users\smosk\code\slipway-spike-shim\docs\spikes\fixtures\bin-shim-windows\bin\shim-probe
args=["one","two words"]
exit=0

$ [Bash] SHIM_EXIT=3 shim-probe; echo "exit=$?"
SHIM OK platform=win32 node=v24.16.0
argv1=C:\Users\smosk\code\slipway-spike-shim\docs\spikes\fixtures\bin-shim-windows\bin\shim-probe
args=[]
exit=3

$ [Bash] ls -l "C:/Users/smosk/code/slipway-spike-shim/docs/spikes/fixtures/bin-shim-windows/bin"; head -c 120 "C:/Users/smosk/code/slipway-spike-shim/docs/spikes/fixtures/bin-shim-windows/bin/shim-probe" | od -c | head -3
total 1
-rwxr-xr-x 1 smosk 197609 250 Nov 27 13:29 shim-probe
0000000   #   !   /   u   s   r   /   b   i   n   /   e   n   v       n
0000020   o   d   e  \n   c   o   n   s   o   l   e   .   l   o   g   (
0000040   `   S   H   I   M       O   K       p   l   a   t   f   o   r

$ [Bash] echo "$PATH" | tr ':' '\n' | grep -i shimspike -n || echo "no PATH entry mentions the fixture"; echo "$PATH" | tr ':' '\n' | grep -n bin-shim-windows || true
10:/tmp/shimspike-BPOdew/node_modules/.bin
60:/c/Users/smosk/code/slipway-spike-shim/docs/spikes/fixtures/bin-shim-windows/bin
```

### Linux control (2.1.332)

The same fixture, run in a Linux container. `command -v shim-probe` resolved to the fixture's `bin/` (on `PATH` at line 18), the probe printed `platform=linux`, and the arguments and exit code behaved as above.

## A first attempt that failed for an unrelated reason

The first Windows run stopped before any tool call. The command-line login on that machine had expired (`authentication_failed`, "this login reached its time limit"). Its `init` event already showed the plugin loaded (`shimspike@inline`, slash command `shimspike:probe`) on both versions. The run above came after `claude auth login`.

## Not covered

- **Only the Bash tool was tested.** Claude Code on Windows also has a PowerShell tool. The design keeps the runner to the Bash tool, and the skills never ask for PowerShell.
- **The plugin was loaded with `--plugin-dir`.** An installed plugin, running from its cache path, was not tried.
