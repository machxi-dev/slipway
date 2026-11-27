import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

test('a shipped lane’s worktree and branch are removed from the main checkout, never from inside', (t) => {
  const repo = ready(t, {});
  assert.equal(slipway(repo, ['worktree', 'D6']).code, 0);
  const wt = path.join(path.dirname(repo), 'shop-D6');
  assert.match(slipway(wt, ['worktree', 'remove', 'D6']).stderr, /from the main checkout/);
  const r = slipway(repo, ['worktree', 'remove', 'D6']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(wt), false);
  assert.equal(git(repo, 'branch', '--list', 'lane/D6'), '');
});

test('a new lane branch starts from the default branch, not from the checkout it is made in', (t) => {
  const repo = ready(t, {});
  git(repo, 'checkout', '-q', '-b', 'lane/D5');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'D5 work');
  assert.equal(slipway(repo, ['worktree', 'D6']).code, 0);
  const wt = path.join(path.dirname(repo), 'shop-D6');
  assert.equal(git(wt, 'rev-parse', 'HEAD'), git(repo, 'rev-parse', 'main'));
});
