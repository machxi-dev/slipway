// `slipway run <name>`: resolve a command from slipway.config.json, take the lock when it is listed under one,
// and spawn it through the platform's shell with the SLIPWAY_* variables (docs/design.md §3.3).
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { laneFromBranch } from './config.mjs';
import { currentBranch } from './git.mjs';
import { acquire } from './lock.mjs';

const SAFE = /^[\w@%+=:,./-]+$/;

/** Quote one argument for the shell `spawn(..., { shell: true })` uses on this platform. */
export function quoteArg(arg, platform = process.platform) {
  if (arg !== '' && SAFE.test(arg)) return arg;
  if (platform === 'win32') return `"${arg.replace(/"/g, '""')}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The variables every command run by slipway sees. */
export function slipwayEnv({ root, config, name, pluginRoot }) {
  const env = { SLIPWAY_ROOT: root, SLIPWAY_COMMAND: name, SLIPWAY_PLUGIN_ROOT: pluginRoot };
  const branch = currentBranch(root);
  if (branch) env.SLIPWAY_BRANCH = branch;
  const lane = laneFromBranch(config, branch);
  if (lane) env.SLIPWAY_LANE = lane.id;
  return env;
}

/**
 * Run command `name` with extra `args`, from the repository root. Resolves to the exit code.
 * Throws an Error with code EUSAGE for an unknown name, ELOCKED when the lock cannot be had in time.
 */
export async function runCommand({ root, config, name, args = [], pluginRoot, log = console.error, lockTimeoutMs }) {
  const base = config.commands[name];
  if (base === undefined) {
    const e = new Error(`no command "${name}" in slipway.config.json; it names: ${Object.keys(config.commands).join(', ')}`);
    e.code = 'EUSAGE';
    throw e;
  }
  const command = [base, ...args.map((a) => quoteArg(a))].join(' ');
  const release = config.locks.tiers.includes(name)
    ? await acquire(root, name, { timeoutMs: lockTimeoutMs, onWait: (m) => log(`slipway: ${m}`) })
    : () => {};
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: root,
        shell: true,
        stdio: 'inherit',
        env: { ...process.env, ...slipwayEnv({ root, config, name, pluginRoot }) },
      });
      // A terminal's Ctrl-C reaches the child itself; a signal sent to slipway alone is passed on.
      const forward = (sig) => child.kill(sig);
      const signals = process.platform === 'win32' ? ['SIGINT'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
      for (const s of signals) process.on(s, forward);
      const done = () => signals.forEach((s) => process.off(s, forward));
      child.on('error', (err) => {
        done();
        reject(err);
      });
      child.on('exit', (code, signal) => {
        done();
        resolve(code ?? 128 + (constants.signals[signal] ?? 0));
      });
    });
  } finally {
    release();
  }
}
