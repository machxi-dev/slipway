// The step check's base and changed paths (§3.3, §14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { git, slipway, tempRepo } from './testing.mjs';

// changed.mjs prints the base line's facts and the changed paths, then exits with STEP_EXIT.
const CHANGED = `import { readFileSync } from 'node:fs';
const paths = readFileSync(process.env.SLIPWAY_CHANGED_PATHS, 'utf8').split('\\n').filter(Boolean);
console.log('CHANGED ' + JSON.stringify(paths.sort()));
process.exit(Number(process.env.STEP_EXIT ?? 0));
`;

function lane(t) {
  const origin = tempRepo(t, 'origin');
  writeFileSync(path.join(origin, 'slipway.config.json'), JSON.stringify({ version: 1, tagPrefix: 'x', commands: { check: 'c', 'step-check': 'node changed.mjs', gate: 'g' } }));
  writeFileSync(path.join(origin, 'changed.mjs'), CHANGED);
  writeFileSync(path.join(origin, '.gitignore'), 'build/\n');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', 'base');
  const repo = path.join(path.dirname(origin), 'clone');
  execFileSync('git', ['clone', '-q', origin, repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Slipway test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'checkout', '-q', '-b', 'lane/D1');
  return repo;
}
const run = (repo, args = [], env = {}) => {
  const r = slipway(repo, ['run', 'step-check', ...args], { env });
  const changed = JSON.parse(/^CHANGED (.*)$/m.exec(r.stdout)?.[1] ?? 'null');
  const why = /^slipway: step-check against (.*)$/m.exec(r.stderr)?.[1];
  return { ...r, changed, why };
};
const write = (repo, p, text = 'x\n') => writeFileSync(path.join(repo, p), text);

test('with no green run, the base is the merge base with the remote default branch; untracked in, ignored out', (t) => {
  const repo = lane(t);
  write(repo, 'a.txt');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'a');
  write(repo, 'untracked.txt');
  mkdirSync(path.join(repo, 'build'));
  write(repo, 'build/out.txt');
  const r = run(repo);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.why, /^the merge base with origin\/main \([0-9a-f]{12}\)/);
  assert.deepEqual(r.changed, ['a.txt', 'untracked.txt']);
});

test('a green run is recorded; the next runs against it, and a red run records nothing', (t) => {
  const repo = lane(t);
  write(repo, 'a.txt');
  assert.equal(run(repo).code, 0);
  write(repo, 'b.txt');
  let r = run(repo, [], { STEP_EXIT: '1' });
  assert.equal(r.code, 1);
  assert.match(r.why, /^the tree proved green at /);
  assert.deepEqual(r.changed, ['b.txt']);
  write(repo, 'c.txt');
  r = run(repo);
  assert.deepEqual(r.changed, ['b.txt', 'c.txt'], 'the red run moved nothing');
  r = run(repo);
  assert.deepEqual(r.changed, []);
});

test('a record on rewritten history is ignored, and --base overrides', (t) => {
  const repo = lane(t);
  write(repo, 'a.txt');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'a');
  assert.equal(run(repo).code, 0);
  git(repo, 'reset', '-q', '--hard', 'origin/main');
  write(repo, 'z.txt');
  let r = run(repo);
  assert.match(r.why, /^the merge base with origin\/main/);
  assert.deepEqual(r.changed, ['z.txt']);
  r = run(repo, ['--base', 'HEAD']);
  assert.equal(r.why, '--base HEAD; 1 changed path');
  assert.deepEqual(r.changed, ['z.txt']);
  assert.equal(slipway(repo, ['run', 'step-check', '--base', 'nope']).code, 2);
});

test('each worktree keeps its own record', (t) => {
  const repo = lane(t);
  write(repo, 'a.txt');
  assert.equal(run(repo).code, 0);
  const other = path.join(path.dirname(repo), 'clone-D2');
  git(repo, 'worktree', 'add', '-q', '-b', 'lane/D2', other, 'origin/main');
  write(other, 'q.txt');
  const r = run(other);
  assert.match(r.why, /^the merge base/);
  assert.deepEqual(r.changed, ['q.txt']);
  assert.ok(existsSync(path.join(repo, '.git', 'slipway', 'proved.json')));
  assert.ok(!readFileSync(path.join(repo, '.git', 'slipway', 'proved.json'), 'utf8').includes('q.txt'));
});
