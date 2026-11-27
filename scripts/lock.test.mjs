import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { acquire, lockPath } from './lock.mjs';
import { BIN, git, slipway, tempRepo } from './testing.mjs';

// A repository whose gate is locked, with a second worktree beside it.
function setup(t) {
  const repo = tempRepo(t);
  writeFileSync(
    path.join(repo, 'slipway.config.json'),
    JSON.stringify({
      version: 1,
      tagPrefix: 'app',
      commands: {
        check: 'node -e "process.exit(0)"',
        'step-check': 'node -e "process.exit(0)"',
        gate: 'node see-lock.mjs',
      },
      locks: { tiers: ['gate'] },
    }),
  );
  // see-lock.mjs prints whether the lock file exists while the gate runs.
  writeFileSync(
    path.join(repo, 'see-lock.mjs'),
    `import { existsSync } from 'node:fs';\nconsole.log('lock held: ' + existsSync(process.env.LOCK_FILE));\n`,
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'config');
  const other = path.join(path.dirname(repo), 'repo-D1');
  git(repo, 'worktree', 'add', '-q', '-b', 'lane/D1', other);
  return { repo, other, lock: lockPath(repo) };
}

test('every worktree of a repository shares one lock file in the git common directory', (t) => {
  const { repo, other, lock } = setup(t);
  assert.equal(lockPath(other), lock);
  assert.equal(path.dirname(path.dirname(lock)), path.join(repo, '.git'));
});

test('a locked command holds the lock while it runs and releases it after', (t) => {
  const { repo, lock } = setup(t);
  const r = slipway(repo, ['run', 'gate'], { env: { LOCK_FILE: lock } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'lock held: true');
  assert.equal(existsSync(lock), false);
});

test('an unlocked command does not take the lock', async (t) => {
  const { repo } = setup(t);
  const release = await acquire(repo, 'someone else');
  t.after(release);
  assert.equal(slipway(repo, ['run', 'check'], { env: { SLIPWAY_LOCK_TIMEOUT: '0' } }).code, 0);
});

test('a lock held from another worktree refuses at once when the timeout is 0', async (t) => {
  const { repo, other } = setup(t);
  const release = await acquire(repo, 'gate');
  t.after(release);
  const r = slipway(other, ['run', 'gate'], { env: { SLIPWAY_LOCK_TIMEOUT: '0' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /the lock is held by "gate" \(pid \d+ on .+, .+, since .+\)/);
});

test('a waiting command says what it waits for and runs once the lock is released', async (t) => {
  const { repo, other, lock } = setup(t);
  const release = await acquire(repo, 'gate');
  const child = spawn(process.execPath, [BIN, 'run', 'gate'], { cwd: other, env: { ...process.env, LOCK_FILE: lock } });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (d) => (stderr += d));
  child.stdout.on('data', (d) => (stdout += d));
  const exited = new Promise((resolve) => child.on('exit', resolve));
  await until(() => stderr.includes('waiting for the lock'));
  release();
  assert.equal(await exited, 0, stderr);
  assert.match(stderr, /slipway: waiting for the lock held by "gate"/);
  assert.equal(stdout.trim(), 'lock held: true');
});

test('a lock left by a process that is gone is broken', async (t) => {
  const { repo, lock } = setup(t);
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, JSON.stringify({ token: 'old', pid: dead, host: hostname(), cwd: repo, command: 'gate', since: 'then' }));
  const r = slipway(repo, ['run', 'gate'], { env: { LOCK_FILE: lock, SLIPWAY_LOCK_TIMEOUT: '0' } });
  assert.equal(r.code, 0, r.stderr);
});

test('a lock held on another machine is never broken', async (t) => {
  const { repo, lock } = setup(t);
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, JSON.stringify({ token: 'x', pid: 1, host: 'elsewhere.invalid', cwd: '/x', command: 'gate', since: 'then' }));
  await assert.rejects(acquire(repo, 'gate', { timeoutMs: 0 }), { code: 'ELOCKED' });
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).host, 'elsewhere.invalid');
});

test('release removes only its own lock', async (t) => {
  const { repo, lock } = setup(t);
  const release = await acquire(repo, 'gate');
  writeFileSync(lock, JSON.stringify({ token: 'someone-else', pid: process.pid, host: hostname() }));
  release();
  assert.equal(existsSync(lock), true);
});

async function until(cond, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
