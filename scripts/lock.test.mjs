import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
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
  const dead = await deadPid();
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

test('a locked command that runs another locked command does not wait on itself', { timeout: 30_000 }, async (t) => {
  const { repo, lock } = setup(t);
  const config = JSON.parse(readFileSync(path.join(repo, 'slipway.config.json'), 'utf8'));
  config.commands.gate = 'node nested.mjs';
  config.commands['step-check'] = 'node see-lock.mjs';
  config.locks.tiers = ['step-check', 'gate'];
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(config));
  writeFileSync(
    path.join(repo, 'nested.mjs'),
    `import { spawnSync } from 'node:child_process';\n` +
      `const r = spawnSync(process.execPath, [${JSON.stringify(BIN)}, 'run', 'step-check'], { stdio: 'inherit' });\n` +
      `process.exit(r.status);\n`,
  );
  const r = slipway(repo, ['run', 'gate'], { env: { LOCK_FILE: lock } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'lock held: true');
  assert.equal(existsSync(lock), false);
});

test(
  'a signal to slipway stops the whole command before the lock is released',
  { skip: process.platform === 'win32' && 'POSIX process groups', timeout: 30_000 },
  async (t) => {
    const { repo, lock } = setup(t);
    const config = JSON.parse(readFileSync(path.join(repo, 'slipway.config.json'), 'utf8'));
    // Two commands joined by && keep the shell alive above the long-running grandchild.
    config.commands.gate = 'node -e "0" && node sleeper.mjs';
    writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(config));
    const pidFile = path.join(repo, 'sleeper.pid');
    writeFileSync(
      path.join(repo, 'sleeper.mjs'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
    );
    const child = spawn(process.execPath, [BIN, 'run', 'gate'], { cwd: repo, stdio: 'ignore' });
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '');
    const sleeper = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(existsSync(lock), true);
    child.kill('SIGTERM');
    const { code } = await exited;
    assert.equal(code, 128 + 15);
    assert.equal(existsSync(lock), false);
    await until(() => gone(sleeper), 5_000);
  },
);

async function until(cond, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

function gone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return err.code === 'ESRCH';
  }
}

// The pid of a process that has exited and that the OS no longer reports as alive. Windows can
// report a pid as alive for a moment after its process exits, so wait for ESRCH, within a bound.
async function deadPid(ms = 5_000) {
  const pid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  await until(() => gone(pid), ms);
  return pid;
}

test('a lock whose runner died while its command’s shell still runs is kept (§14)', async (t) => {
  const { repo, lock } = setup(t);
  const dead = await deadPid();
  const shell = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  t.after(() => shell.kill());
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, JSON.stringify({ token: 'old', pid: dead, child: shell.pid, host: hostname(), cwd: repo, command: 'gate', since: 'then' }));
  await assert.rejects(acquire(repo, 'gate', { timeoutMs: 0 }), { code: 'ELOCKED' });
});

test('the lock names the command’s shell while it runs', async (t) => {
  const { repo, lock } = setup(t);
  writeFileSync(path.join(repo, 'see-lock.mjs'), `import { readFileSync } from 'node:fs';\nconsole.log('child ' + JSON.parse(readFileSync(process.env.LOCK_FILE, 'utf8')).child);\n`);
  const r = slipway(repo, ['run', 'gate'], { env: { LOCK_FILE: lock } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^child \d+$/m);
});

test('a stale lock is taken over only under the claim; a claim left by a dead waiter is cleared', async (t) => {
  const { repo, lock } = setup(t);
  const dead = await deadPid();
  mkdirSync(path.dirname(lock), { recursive: true });
  const old = JSON.stringify({ token: 'old', pid: dead, host: hostname(), cwd: repo, command: 'gate', since: 'then' });
  writeFileSync(lock, old);
  writeFileSync(`${lock}.claim`, '1');
  // Another waiter holds a fresh claim: this one leaves the stale lock alone.
  const pending = acquire(repo, 'gate', { timeoutMs: 0 });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(readFileSync(lock, 'utf8'), old);
  // The claim grows old, as one whose waiter died would: it is cleared and the takeover goes ahead.
  const then = new Date(Date.now() - 60_000);
  utimesSync(`${lock}.claim`, then, then);
  const release = await pending;
  assert.notEqual(readFileSync(lock, 'utf8'), old);
  assert.equal(existsSync(`${lock}.claim`), false);
  release();
});
