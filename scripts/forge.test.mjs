import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runState } from './forge.mjs';
import { git, slipway, tempRepo } from './testing.mjs';

function ready(t, forge) {
  const origin = tempRepo(t, 'origin');
  git(origin, 'config', 'receive.denyCurrentBranch', 'updateInstead');
  const repo = path.join(path.dirname(origin), 'clone');
  execFileSync('git', ['clone', '-q', origin, repo]);
  for (const [k, v] of [['user.email', 'test@example.invalid'], ['user.name', 'Slipway test'], ['commit.gpgsign', 'false']]) git(repo, 'config', k, v);
  assert.equal(slipway(repo, ['init', '--check', 'x', '--forge', forge]).code, 0);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { origin, repo };
}

test('runs on one commit are classed green, red, running, cancelled or none', () => {
  const run = (headSha, status, conclusion) => ({ headSha, status, conclusion, url: 'u' });
  assert.equal(runState([], 'a').state, 'none');
  assert.equal(runState([run('b', 'completed', 'success')], 'a').state, 'none');
  assert.equal(runState([run('a', 'in_progress', null), run('a', 'completed', 'failure')], 'a').state, 'running');
  assert.equal(runState([run('a', 'completed', 'success')], 'a').state, 'green');
  assert.equal(runState([run('a', 'completed', 'failure')], 'a').state, 'red');
  assert.equal(runState([run('a', 'completed', 'cancelled')], 'a').state, 'cancelled');
});

test('forge none: no pull request or CI, and the merge is a local --no-ff merge pushed to origin (§3.3)', (t) => {
  const { origin, repo } = ready(t, 'none');
  assert.equal(slipway(repo, ['worktree', 'D1']).code, 0);
  const wt = path.join(path.dirname(repo), 'clone-D1');
  writeFileSync(path.join(wt, 'a.txt'), 'a\n');
  git(wt, 'add', 'a.txt');
  git(wt, 'commit', '-q', '-m', 'feat: D1.1 a');
  for (const verb of ['pr-open', 'pr', 'comment', 'ready', 'run']) assert.equal(slipway(wt, ['forge', verb]).code, 0, verb);
  assert.match(slipway(wt, ['forge', 'run']).stdout, /^off: forge none runs no CI$/m);
  const r = slipway(wt, ['forge', 'merge']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^merged lane\/D1 into main/m);
  const parents = git(repo, 'rev-list', '--parents', '-n', '1', 'main').split(' ');
  assert.equal(parents.length, 3, 'a merge commit');
  assert.equal(parents[2], git(wt, 'rev-parse', 'HEAD'));
  assert.equal(git(origin, 'rev-parse', 'main'), parents[0], 'pushed');
});

test('forge github goes through gh: an open pull request is reused, and a run is read on the pushed head', (t) => {
  const { repo } = ready(t, 'github');
  git(repo, 'checkout', '-q', '-b', 'lane/D2');
  git(repo, 'push', '-q', '-u', 'origin', 'lane/D2');
  const head = git(repo, 'rev-parse', 'HEAD');
  const log = path.join(path.dirname(repo), 'gh.log');
  const fake = path.join(path.dirname(repo), 'gh.mjs');
  writeFileSync(
    fake,
    `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'list') console.log(process.env.FAKE_OPEN ?? '[]');
else if (args[0] === 'pr' && args[1] === 'create') console.log('https://github.com/o/r/pull/9');
else if (args[0] === 'run' && args[1] === 'list') console.log(JSON.stringify([{ headSha: ${JSON.stringify(head)}, status: 'completed', conclusion: 'failure', url: 'https://run/1', databaseId: 1 }]));
else if (args[0] === 'run' && args[1] === 'view') console.log('the failing log');
`,
  );
  writeFileSync(path.join(repo, '..', 'body.md'), 'body');
  const env = { SLIPWAY_GH: fake };
  let r = slipway(repo, ['forge', 'pr-open', '--title', 'D2 — Things', '--body-file', '../body.md'], { env });
  assert.equal(r.stdout.trim(), 'https://github.com/o/r/pull/9', r.stderr);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.at(-1), ['pr', 'create', '--draft', '--base', 'main', '--head', 'lane/D2', '--title', 'D2 — Things', '--body-file', '../body.md']);
  r = slipway(repo, ['forge', 'pr-open', '--title', 'x', '--body-file', 'y'], { env: { ...env, FAKE_OPEN: '[{"url":"https://github.com/o/r/pull/8"}]' } });
  assert.equal(r.stdout.trim(), 'https://github.com/o/r/pull/8');
  r = slipway(repo, ['forge', 'run', '--log'], { env });
  assert.equal(r.code, 1);
  assert.match(r.stdout, new RegExp(`^red ${head.slice(0, 12)} https://run/1\\nthe failing log$`, 'm'));
  const runList = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((c) => c[1] === 'list' && c[0] === 'run');
  assert.deepEqual(runList.slice(0, 4), ['run', 'list', '--commit', head]);
});
