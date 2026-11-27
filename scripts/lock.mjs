// The lock across worktrees (docs/design.md §3.3, §11): one file in the git common directory, cross-platform.
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { commonDir } from './git.mjs';

export const lockPath = (cwd) => path.join(commonDir(cwd), 'slipway', 'lock');

const POLL_MS = 250;
const UNREADABLE_GRACE_MS = 10_000;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function readOwner(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    return null; // present but unreadable: being written, or left half-written by a crash
  }
}

/** A holder is stale when it ran on this machine and its process is gone, or its file stayed unreadable. */
function stale(file, owner) {
  if (owner === null) {
    try {
      return Date.now() - statSync(file).mtimeMs > UNREADABLE_GRACE_MS;
    } catch {
      return false;
    }
  }
  return owner.host === hostname() && !alive(owner.pid);
}

const describe = (o) =>
  o ? `"${o.command}" (pid ${o.pid} on ${o.host}, ${o.cwd}, since ${o.since})` : 'an unreadable lock file';

/**
 * Take the lock, waiting while another live process holds it. Resolves to a release function.
 * timeoutMs: undefined waits for ever; 0 fails at once when the lock is held.
 */
export async function acquire(cwd, command, { timeoutMs, onWait = () => {} } = {}) {
  const file = lockPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const token = randomUUID();
  const me = { token, pid: process.pid, host: hostname(), cwd, command, since: new Date().toISOString() };
  const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
  let told = false;
  for (;;) {
    try {
      writeFileSync(file, JSON.stringify(me), { flag: 'wx' });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    const owner = readOwner(file);
    if (owner === undefined) continue;
    if (stale(file, owner)) {
      // Re-read just before removing, so a waiter that already replaced the stale file keeps its lock.
      const again = readOwner(file);
      if (again === owner || (again && owner && again.token === owner.token)) {
        try {
          unlinkSync(file);
        } catch {}
      }
      continue;
    }
    if (Date.now() >= deadline) {
      const e = new Error(`the lock is held by ${describe(owner)}`);
      e.code = 'ELOCKED';
      throw e;
    }
    if (!told) {
      onWait(`waiting for the lock held by ${describe(owner)}`);
      told = true;
    }
    await sleep(POLL_MS);
  }
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    if (readOwner(file)?.token === token) {
      try {
        unlinkSync(file);
      } catch {}
    }
  };
}
