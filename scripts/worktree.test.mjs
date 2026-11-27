import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { git, slipway, tempRepo } from './testing.mjs';

function ready(t, lane) {
  const repo = tempRepo(t, 'shop');
  assert.equal(slipway(repo, ['init', '--check', 'x']).code, 0);
  const cfg = JSON.parse(readFileSync(path.join(repo, 'slipway.config.json'), 'utf8'));
  cfg.lane = { ...cfg.lane, ...lane };
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(cfg));
  writeFileSync(path.join(repo, '.gitignore'), '.env\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

test('a lane worktree is made beside the repository, gets lane.copy, and runs lane.setup once', (t) => {
  const repo = ready(t, {
    copy: ['.env', 'missing.env'],
    setup: 'node -e "require(\'fs\').writeFileSync(\'setup.txt\', process.env.SLIPWAY_LANE + \' \' + process.env.SLIPWAY_BRANCH)"',
  });
  writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
  const r = slipway(repo, ['worktree', 'D3']);
  assert.equal(r.code, 0, r.stderr);
  const wt = path.join(path.dirname(repo), 'shop-D3');
  assert.equal(r.stdout.trim().split('\n').at(-1), wt);
  assert.match(r.stdout, /^copied \.env$/m);
  assert.match(r.stdout, /^skipped missing\.env: not in /m);
  assert.doesNotMatch(r.stdout, /SECRET/, 'contents are never printed');
  assert.equal(readFileSync(path.join(wt, '.env'), 'utf8'), 'SECRET=1\n');
  assert.equal(readFileSync(path.join(wt, 'setup.txt'), 'utf8'), 'd3 lane/D3');
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lane/D3');
  // Again: reused, no setup.
  writeFileSync(path.join(wt, 'setup.txt'), 'kept');
  assert.equal(slipway(repo, ['worktree', 'D3']).code, 0);
  assert.equal(readFileSync(path.join(wt, 'setup.txt'), 'utf8'), 'kept');
});

test('a worktree on another branch is refused; an existing branch is checked out', (t) => {
  const repo = ready(t, {});
  git(repo, 'branch', 'lane/D5');
  assert.equal(slipway(repo, ['worktree', 'D5']).code, 0);
  const wt = path.join(path.dirname(repo), 'shop-D5');
  git(wt, 'checkout', '-q', '-b', 'other');
  const r = slipway(repo, ['worktree', 'D5']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /is a worktree on other, not lane\/D5/);
});

test('a shipped lane’s worktree and branch are removed, from the main checkout or from inside the worktree', (t) => {
  const repo = ready(t, {});
  assert.equal(slipway(repo, ['worktree', 'D6']).code, 0);
  const wt = path.join(path.dirname(repo), 'shop-D6');
  let r = slipway(repo, ['worktree', 'remove', 'D6']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(wt), false);
  assert.equal(git(repo, 'branch', '--list', 'lane/D6'), '');
  // The session that shipped sits in the worktree; it removes it from there.
  assert.equal(slipway(repo, ['worktree', 'D7']).code, 0);
  const wt7 = path.join(path.dirname(repo), 'shop-D7');
  r = slipway(wt7, ['worktree', 'remove', 'D7']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(wt7), false);
  assert.equal(git(repo, 'branch', '--list', 'lane/D7'), '');
  // Windows: git emptied and unregistered the worktree but a shell held the folder. The branch still goes,
  // and a later run from the main checkout finishes the folder.
  assert.equal(slipway(repo, ['worktree', 'D8']).code, 0);
  const wt8 = path.join(path.dirname(repo), 'shop-D8');
  git(repo, 'worktree', 'remove', wt8);
  mkdirSync(wt8);
  r = slipway(repo, ['worktree', 'remove', 'D8']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(wt8), false);
  assert.equal(git(repo, 'branch', '--list', 'lane/D8'), '');
});

/** ready(t) with a bare origin that has main, tracked, and a second clone that has moved origin's main on. */
function behindOrigin(t) {
  const repo = ready(t, {});
  const origin = path.join(path.dirname(repo), 'origin.git');
  git(path.dirname(repo), 'init', '-q', '--bare', origin);
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  const other = path.join(path.dirname(repo), 'other');
  git(path.dirname(repo), 'clone', '-q', '-b', 'main', origin, other);
  git(other, 'config', 'user.email', 'test@example.invalid');
  git(other, 'config', 'user.name', 'Slipway test');
  git(other, 'config', 'commit.gpgsign', 'false');
  git(other, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(other, 'merged.txt'), 'shipped\n');
  git(other, 'add', 'merged.txt');
  git(other, 'commit', '-q', '-m', 'the lane merged');
  git(other, 'push', '-q', 'origin', 'main');
  return { repo, other, head: git(other, 'rev-parse', 'HEAD') };
}

/** In `other`, a lane on `branch` whose plan's `- Branch:` names it, pushed and merged into origin's main. */
function mergedLane(repo, other, n, branch) {
  const plans = JSON.parse(readFileSync(path.join(repo, 'slipway.config.json'), 'utf8')).docs?.plans ?? 'docs/plan';
  git(other, 'checkout', '-q', '-b', branch, 'main');
  mkdirSync(path.join(other, plans), { recursive: true });
  writeFileSync(path.join(other, plans, `D${n}.md`), `# D${n}. A lane\n\n- Status: shipped\n- Records: none\n- CI: off\n- Branch: \`${branch}\`\n`);
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', `D${n}`);
  git(other, 'push', '-q', 'origin', branch);
  git(other, 'checkout', '-q', 'main');
  git(other, 'merge', '-q', '--no-ff', '-m', `Merge ${branch}`, branch);
  git(other, 'push', '-q', 'origin', 'main');
  git(repo, 'fetch', '-q', 'origin', branch);
  git(repo, 'branch', '-q', branch, `origin/${branch}`);
}

test('worktree remove finds the plan’s branch from the main checkout on another branch, in the worktree or on the default branch', (t) => {
  const { repo, other } = behindOrigin(t);
  mergedLane(repo, other, 6, 'claude/thread-six');
  mergedLane(repo, other, 7, 'claude/thread-seven');
  const wt = path.join(path.dirname(repo), 'shop-D6');
  git(repo, 'worktree', 'add', '-q', wt, 'claude/thread-six');
  git(repo, 'checkout', '-q', '-b', 'elsewhere');
  // D6: the worktree is still there, and its plan names the branch.
  let r = slipway(repo, ['worktree', 'remove', 'D6']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(wt), false);
  assert.equal(git(repo, 'branch', '--list', 'claude/thread-six'), '');
  assert.equal(git(repo, 'ls-remote', '--heads', 'origin', 'claude/thread-six'), '');
  // D7: no worktree, and this checkout has no plan; the default branch, brought up to origin, has it.
  r = slipway(repo, ['worktree', 'remove', 'D7']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(git(repo, 'branch', '--list', 'claude/thread-seven'), '');
  assert.equal(git(repo, 'ls-remote', '--heads', 'origin', 'claude/thread-seven'), '');
});

test('worktree remove updates the default branch when the main checkout is on another branch', (t) => {
  const { repo, head } = behindOrigin(t);
  assert.equal(slipway(repo, ['worktree', 'D6']).code, 0);
  git(repo, 'checkout', '-q', '-b', 'elsewhere');
  const r = slipway(repo, ['worktree', 'remove', 'D6']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^updated main from origin$/m);
  assert.equal(git(repo, 'rev-parse', 'main'), head);
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'elsewhere', 'the checkout stays where it was');
  assert.equal(existsSync(path.join(path.dirname(repo), 'shop-D6')), false);
  assert.equal(git(repo, 'branch', '--list', 'lane/D6'), '');
});

test('worktree remove updates the default branch with a fast-forward pull when it is checked out', (t) => {
  const { repo, head } = behindOrigin(t);
  assert.equal(slipway(repo, ['worktree', 'D6']).code, 0);
  const wt = path.join(path.dirname(repo), 'shop-D6');
  const r = slipway(repo, ['worktree', 'remove', 'D6']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^pulled main in /m);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(path.join(repo, 'merged.txt'), 'utf8'), 'shipped\n', 'the working tree has the merge');
  assert.equal(existsSync(wt), false);
  assert.equal(git(repo, 'branch', '--list', 'lane/D6'), '');
});

test('worktree remove refuses, and removes nothing, when the default branch has diverged from origin', (t) => {
  const { repo } = behindOrigin(t);
  assert.equal(slipway(repo, ['worktree', 'D6']).code, 0);
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'local only');
  const r = slipway(repo, ['worktree', 'remove', 'D6']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /nothing was removed/);
  assert.equal(existsSync(path.join(path.dirname(repo), 'shop-D6')), true);
  assert.notEqual(git(repo, 'branch', '--list', 'lane/D6'), '');
});

test('a stale worktree entry that has the default branch is not pulled in; git’s refusal is said, and nothing is removed', (t) => {
  const { repo, head } = behindOrigin(t);
  assert.equal(slipway(repo, ['worktree', 'D6']).code, 0);
  git(repo, 'checkout', '-q', '-b', 'elsewhere');
  const stale = path.join(path.dirname(repo), 'stale');
  git(repo, 'worktree', 'add', '-q', stale, 'main');
  rmSync(stale, { recursive: true, force: true });
  const r = slipway(repo, ['worktree', 'remove', 'D6']);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /git fetch -q origin main:main: fatal: refusing to fetch into branch .*; nothing was removed/);
  assert.notEqual(git(repo, 'rev-parse', 'main'), head);
  assert.equal(existsSync(path.join(path.dirname(repo), 'shop-D6')), true);
});

test('a new lane branch starts from the default branch, not from the checkout it is made in', (t) => {
  const repo = ready(t, {});
  git(repo, 'checkout', '-q', '-b', 'lane/D5');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'D5 work');
  assert.equal(slipway(repo, ['worktree', 'D6']).code, 0);
  const wt = path.join(path.dirname(repo), 'shop-D6');
  assert.equal(git(wt, 'rev-parse', 'HEAD'), git(repo, 'rev-parse', 'main'));
});
