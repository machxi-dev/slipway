// `slipway run <name>`: resolve a command from slipway.config.json, take the lock when it is listed under one,
// and spawn it through the platform's shell with the SLIPWAY_* variables (docs/design.md §3.3).
import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:os';
import { laneFromBranch } from './config.mjs';
import { currentBranch } from './git.mjs';
import { HELD, acquire } from './lock.mjs';

const SAFE_POSIX = /^[\w@%+=:,./-]+$/;
const SAFE_WIN32 = /^[\w@+=:,./\\-]+$/;

/**
 * Quote one argument for the shell `spawn(..., { shell: true })` uses: /bin/sh, or cmd.exe on Windows.
 * cmd.exe expands %VAR% even inside double quotes, so a % is left outside them and escaped with ^.
 */
export function quoteArg(arg, platform = process.platform) {
  if (platform === 'win32') {
    if (arg !== '' && SAFE_WIN32.test(arg)) return arg;
    return arg
      .split('%')
      .map((part) => `"${part.replace(/"/g, '""')}"`)
      .join('^%');
  }
  if (arg !== '' && SAFE_POSIX.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The SLIPWAY_* variables a command sees. Branch and lane are removed when they do not apply. */
export function slipwayEnv({ root, config, name, pluginRoot, base = process.env }) {
  const env = { ...base, SLIPWAY_ROOT: root, SLIPWAY_COMMAND: name, SLIPWAY_PLUGIN_ROOT: pluginRoot };
  delete env.SLIPWAY_BRANCH;
  delete env.SLIPWAY_LANE;
  const branch = currentBranch(root);
  if (branch) env.SLIPWAY_BRANCH = branch;
  const lane = laneFromBranch(config, branch);
  if (lane) env.SLIPWAY_LANE = lane.id;
  return env;
}

/** Signal the command and everything it started: its process group on POSIX, its process tree on Windows. */
function signalTree(child, sig) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, sig);
  } catch {
    child.kill(sig);
  }
}

/**
 * Run command `name` with extra `args`, from the repository root. Resolves to the exit code.
 * Throws an Error with code EUSAGE for an unknown name, ELOCKED when the lock cannot be had in time.
 */
export async function runCommand({ root, config, name, args = [], pluginRoot, log = console.error, lockTimeoutMs }) {
  if (!Object.hasOwn(config.commands, name)) {
    const e = new Error(`no command "${name}" in slipway.config.json; it names: ${Object.keys(config.commands).join(', ')}`);
    e.code = 'EUSAGE';
    throw e;
  }
  const command = [config.commands[name], ...args.map((a) => quoteArg(a))].join(' ');
  const env = slipwayEnv({ root, config, name, pluginRoot });
  let release = () => {};
  if (config.locks.tiers.includes(name)) {
    release = await acquire(root, name, { timeoutMs: lockTimeoutMs, onWait: (m) => log(`slipway: ${m}`) });
    env[HELD] = release.token;
  }
  try {
    return await new Promise((resolve, reject) => {
      // On POSIX the command leads its own process group, so a signal reaches every process it started
      // and the lock is not released while any of them still runs.
      const child = spawn(command, { cwd: root, shell: true, stdio: 'inherit', env, detached: process.platform !== 'win32' });
      if (child.pid) release.setChild?.(child.pid);
      const signals = process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
      const forward = (sig) => signalTree(child, sig);
      for (const s of signals) process.on(s, forward);
      const done = () => signals.forEach((s) => process.off(s, forward));
      child.on('error', (err) => {
        done();
        reject(err);
      });
      child.on('close', (code, signal) => {
        done();
        resolve(code ?? 128 + (constants.signals[signal] ?? 0));
      });
    });
  } finally {
    release();
  }
}
