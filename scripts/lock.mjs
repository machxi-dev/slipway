// The lock across worktrees (docs/design.md §3.3, §11): one file in the git common directory, cross-platform.
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { commonDir } from './git.mjs';

export const lockPath = (cwd) => path.join(commonDir(cwd), 'slipway', 'lock');

/** Set in a locked command's environment to the holder's token, so a nested locked run does not wait on itself. */
export const HELD = 'SLIPWAY_LOCK_TOKEN';

const POLL_MS = 250;
const UNREADABLE_GRACE_MS = 10_000;
/** A takeover claim this old was left by a waiter that died while holding it. */
const CLAIM_GRACE_MS = 10_000;

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

/**
 * A holder is stale when it ran on this machine and both its runner and the command's shell are gone, or its
 * file stayed unreadable. The shell outlives a runner killed by a signal it cannot catch (§14).
 */
function stale(file, owner) {
  if (owner === undefined) return false;
  if (owner === null) {
    try {
      return Date.now() - statSync(file).mtimeMs > UNREADABLE_GRACE_MS;
    } catch {
      return false;
    }
  }
  return owner.host === hostname() && !alive(owner.pid) && !(owner.child && alive(owner.child));
}

/** Take the takeover claim, clearing one a dead waiter left behind. True when this process holds it. */
function claim(file) {
  const c = `${file}.claim`;
  try {
    writeFileSync(c, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  try {
    if (Date.now() - statSync(c).mtimeMs > CLAIM_GRACE_MS) unlinkSync(c);
  } catch {}
  return false;
}

const describe = (o) =>
  o ? `"${o.command}" (pid ${o.pid} on ${o.host}, ${o.cwd}, since ${o.since})` : 'an unreadable lock file';

/**
 * Take the lock, waiting while another live process holds it. Resolves to a release function.
 * timeoutMs: undefined waits for ever; 0 fails at once when the lock is held.
 * The release function carries the holder's `token`, for the HELD variable.
 */
export async function acquire(cwd, command, { timeoutMs, onWait = () => {}, heldAbove = process.env[HELD] } = {}) {
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
    if (owner && heldAbove && owner.token === heldAbove) {
      // A locked command running `slipway run` for another locked command: the lock is already ours.
      const nested = () => {};
      nested.token = heldAbove;
      nested.setChild = () => {};
      return nested;
    }
    if (stale(file, owner)) {
      // Only one waiter takes over: it claims first, then judges the holder again under the claim (§14).
      if (claim(file)) {
        try {
          const again = readOwner(file);
          const same = owner === null ? again === null : again?.token === owner.token;
          if (same && stale(file, again)) unlinkSync(file);
        } catch {
        } finally {
          try {
            unlinkSync(`${file}.claim`);
          } catch {}
        }
        continue;
      }
      await sleep(POLL_MS);
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
  release.token = token;
  /** Name the command's shell in the lock, so the lock stays held while it runs even if this process dies. */
  release.setChild = (pid) => {
    if (readOwner(file)?.token === token) writeFileSync(file, JSON.stringify({ ...me, child: pid }));
  };
  return release;
  function release() {
    if (released) return;
    released = true;
    if (readOwner(file)?.token === token) {
      try {
        unlinkSync(file);
      } catch {}
    }
  }
}
