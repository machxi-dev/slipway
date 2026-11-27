// The `slipway` command line: the runner and the plugin's verbs (docs/design.md §3.2, §3.3).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError, loadConfig } from './config.mjs';
import { repoRoot } from './git.mjs';
import { runCommand } from './run.mjs';

const USAGE = `usage: slipway <verb> [args]

  run <name> [args...]   run a command named in slipway.config.json, from the repository root
  run                    list the command names
  config                 check slipway.config.json and print it with its defaults filled in
  version                print the plugin's version

Commands run through the platform's shell with SLIPWAY_ROOT, SLIPWAY_COMMAND, SLIPWAY_BRANCH,
SLIPWAY_LANE (on a lane branch) and SLIPWAY_PLUGIN_ROOT set. A command listed under locks.tiers
waits for the lock across worktrees; SLIPWAY_LOCK_TIMEOUT (seconds) bounds the wait.`;

class UsageError extends Error {}

function needRepo(cwd) {
  const root = repoRoot(cwd);
  if (!root) throw new UsageError('not inside a git repository');
  return root;
}

const verbs = {
  async run(args, { cwd, pluginRoot, out, err }) {
    const root = needRepo(cwd);
    const config = loadConfig(root);
    const [name, ...rest] = args;
    if (!name) {
      for (const [n, c] of Object.entries(config.commands)) {
        out(`${n}${config.locks.tiers.includes(n) ? ' (locked)' : ''}: ${c}`);
      }
      return 0;
    }
    const t = (process.env.SLIPWAY_LOCK_TIMEOUT ?? '').trim();
    const lockTimeoutMs = t === '' ? undefined : Number(t) * 1000;
    if (lockTimeoutMs !== undefined && !(Number.isFinite(lockTimeoutMs) && lockTimeoutMs >= 0)) {
      throw new UsageError('SLIPWAY_LOCK_TIMEOUT must be a number of seconds, 0 or more');
    }
    return runCommand({ root, config, name, args: rest, pluginRoot, log: err, lockTimeoutMs });
  },
  async config(args, { cwd, out }) {
    out(JSON.stringify(loadConfig(needRepo(cwd)), null, 2));
    return 0;
  },
  async version(args, { pluginRoot, out }) {
    out(JSON.parse(readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version);
    return 0;
  },
};

/** Entry point for bin/slipway. Resolves to the process exit code. */
export async function main(argv, { pluginRoot, cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  const [verb, ...args] = argv;
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    (verb ? out : err)(USAGE);
    return verb ? 0 : 2;
  }
  if (verb === '--version') return main(['version', ...args], { pluginRoot, cwd, out, err });
  const fn = Object.hasOwn(verbs, verb) ? verbs[verb] : undefined;
  if (!fn) {
    err(`slipway: unknown verb "${verb}"\n\n${USAGE}`);
    return 2;
  }
  try {
    return await fn(args, { cwd, pluginRoot, out, err });
  } catch (e) {
    err(`slipway ${verb}: ${e.message}`);
    if (e instanceof UsageError || e instanceof ConfigError || ['EUSAGE', 'ENOENT'].includes(e.code)) return 2;
    return 1;
  }
}
