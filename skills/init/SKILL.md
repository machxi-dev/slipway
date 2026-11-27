---
name: init
description: Make this repository ready for the Slipway process — the config, the three-file ledger, the records index and the process record, the digests and their rule loaders, the budget file, the settings lines, the CLAUDE.md sentence and the README setup line. With --brownfield, adopt an existing records folder and split an existing ledger.
argument-hint: "[--brownfield]"
disable-model-invocation: true
---

# Make the repository ready: $ARGUMENTS

Governed by the design's §3.2, §12 and §13.4. The script does the writing; this skill finds the values it needs and asks the operator for them in one batch. `slipway init` never overwrites a file, so running it again is safe.

1. **The runner.** Run `slipway version`. If the command is not found, or says Node is too old, stop: Slipway needs Node 20 or later on `PATH`, and the plugin must be enabled in this session.
2. **A config already there.** If `slipway.config.json` exists, run `slipway config`. If it fails, show its problems and stop; the operator fixes the file. If it passes, go to step 5: options would change nothing.
3. **Find the values, reading rather than asking.** Look at the repository's own files, never guessing a tool it does not use:
   - the commands: the package manifest's scripts, a `Makefile` or `justfile`, the build file of the language, and the CI workflow's steps. `check` is the fast inner loop a builder runs while working. `step-check` is what proves a step before its commit; it receives the changed paths in the file `SLIPWAY_CHANGED_PATHS` names, and may simply equal `check`. `gate` proves the whole tree before a ship, and is often the CI job's commands joined with `&&`. Write each as the shell line the repository already uses.
   - the forge: `github` when `origin` is on GitHub and `gh auth status` succeeds, else `none`.
   - the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`), a short tag prefix (the repository's name), and any existing folders for records, plans, digests or behaviour specs.
   - brownfield signs: an existing records folder, an existing plan or ledger file, existing process skills or scripts.
4. **Ask once.** Put every value to the operator in one message, each with what you found and your recommendation: the three commands, the forge, the tag prefix, the docs paths, and, where you saw brownfield signs and the argument did not say `--brownfield`, whether to adopt. Wait for the answer. A missing `gate` is fine: it defaults to `check` (§12).
5. **Run the script**, quoting each command as one argument:

   ```
   slipway init --check "<check>" --step-check "<step-check>" --gate "<gate>" --forge <github|none> --tag-prefix <prefix> [--records <dir>] [--plans <dir>] [--digests <dir>] [--specs <dir or none>] [--brownfield]
   ```

   With a config already present, run `slipway init` with `--brownfield` alone or nothing. It prints one line per file — `wrote`, `kept`, `updated`, `adopted` or `split` — and warnings on standard error.
6. **Read the warnings.** A Claude Code older than the plugin's minimum is the operator's to update. A records folder or ledger "in another shape" means the operator chose not to adopt; say what `--brownfield` would do. Rows whose status could not be read were kept as `planned`; list them for the operator to correct.
7. **Areas.** Where the repository has parts with different conventions (an API and a web app, say), offer an `areas` entry for each in `slipway.config.json` — `paths` globs, and the conventions `skills` a builder reads there, from `.claude/skills/<name>/SKILL.md` (a skill kept elsewhere is reported not found) — and run `slipway init` again to write their digests and path-scoped loaders.
8. **Prove it.** Run `slipway digest` to write the general digest from the process record, then `slipway docs-check`. Both must pass; a failure here is a defect to report, not to work around.
9. **Brownfield follow-up** (§13.5). The process record was written `proposed`. Tell the operator the adopting lane accepts it with `/slipway:adr accept <n>` once it lists the old process records it supersedes on its `- Supersedes:` line, and that the old process skills and scripts are deleted in that lane.
10. **Report** the files written, and that each clone installs the plugin once with `claude plugin install slipway@slipway --scope project` (the README now says so). Offer to commit the files by explicit path on a short branch as `chore: adopt Slipway`; do not commit unasked.

Never: edit a file `init` reported as kept to make it match a template; write a command the repository does not have; run the commands while finding them.
