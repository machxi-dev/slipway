---
name: inline
description: Spike fixture (inline). Reports how CLAUDE_PLUGIN_ROOT resolves.
disable-model-invocation: true
---

Spike fixture. Do exactly this and nothing else.

1. Copy this line into your answer verbatim, character for character, without interpreting it: TEXT=[${CLAUDE_PLUGIN_ROOT}]
2. Run this one Bash command and copy its full output into your answer verbatim:

   printf 'ENV=[%s]\n' "$CLAUDE_PLUGIN_ROOT"; command -v spike-probe; spike-probe

3. Run this Bash command and copy its output: ls "${CLAUDE_PLUGIN_ROOT}/bin"

4. Answer whether you are running as a subagent (yes or no).
