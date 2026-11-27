---
name: probe
description: Spike fixture. Runs the extensionless bin/shim-probe from the Bash tool.
disable-model-invocation: true
---

Spike fixture. Run each command below as its own Bash tool call, exactly as written, and copy every command's full output, including errors, into your answer verbatim under a heading naming the command. Do not fix, retry or work around a failure.

1. `uname -a; echo "SHELL=$SHELL"; command -v bash node git`
2. `command -v shim-probe; echo "exit=$?"`
3. `shim-probe one "two words"; echo "exit=$?"`
4. `SHIM_EXIT=3 shim-probe; echo "exit=$?"`
5. `ls -l "${CLAUDE_PLUGIN_ROOT}/bin"; head -c 120 "${CLAUDE_PLUGIN_ROOT}/bin/shim-probe" | od -c | head -3`
6. `echo "$PATH" | tr ':' '\n' | grep -i shimspike -n || echo "no PATH entry mentions the fixture"; echo "$PATH" | tr ':' '\n' | grep -n bin-shim-windows || true`
