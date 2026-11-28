import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runState } from './forge.mjs';
import { git, slipway, tempRepo } from './testing.mjs';

const PLAN = readFileSync(new URL('./fixtures/plan.md', import.meta.url), 'utf8');

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
  // Each workflow's newest run counts, and any red one makes the commit red.
  const wf = (name, conclusion) => ({ ...run('a', 'completed', conclusion), workflowName: name });
  assert.equal(runState([wf('test', 'success'), wf('lint', 'failure')], 'a').state, 'red');
  assert.equal(runState([wf('test', 'success'), wf('test', 'failure')], 'a').state, 'green', 'a re-run supersedes');
});

test('forge none: no pull request or CI, and the merge is a local --no-ff merge pushed to origin (§3.3)', (t) => {
  const { origin, repo } = ready(t, 'none');
  assert.equal(slipway(repo, ['worktree', 'D1']).code, 0);
  const wt = path.join(path.dirname(repo), 'clone-D1');
  writeFileSync(path.join(wt, 'a.txt'), 'a\n');
  git(wt, 'add', 'a.txt');
  git(wt, 'commit', '-q', '-m', 'feat: D1.1 a');
  git(wt, 'push', '-q', '-u', 'origin', 'lane/D1');
  // Another clone moved origin's main on: the merge brings the local main up to it first.
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'elsewhere');
  for (const verb of ['pr-open', 'pr', 'ready', 'run']) assert.equal(slipway(wt, ['forge', verb]).code, 0, verb);
  // Step comments are kept in the worktree's git dir, so a resumed build can see which steps were reviewed.
  assert.equal(slipway(wt, ['forge', 'comments']).stdout, '');
  writeFileSync(path.join(wt, '..', 'c1.md'), 'D1.1 reviewed: clean\n\nfeat: D1.1 a\n');
  writeFileSync(path.join(wt, '..', 'c2.md'), '\nD1.2 reviewed: 2 findings, fixed in abc\n');
  assert.equal(slipway(wt, ['forge', 'comment', '--body-file', '../c1.md']).code, 0);
  assert.equal(slipway(wt, ['forge', 'comment', '--body-file', '../c2.md']).code, 0);
  assert.equal(slipway(wt, ['forge', 'comments']).stdout, 'D1.1 reviewed: clean\nD1.2 reviewed: 2 findings, fixed in abc\n');
  assert.equal(slipway(repo, ['forge', 'comments']).stdout, '', 'per worktree');
  // A line cut short by a crash is skipped, not fatal.
  const file = path.join(path.resolve(wt, git(wt, 'rev-parse', '--git-common-dir')), 'slipway', 'comments', 'lane-D1.jsonl');
  writeFileSync(file, readFileSync(file, 'utf8') + '"D1.3 revi');
  assert.equal(slipway(wt, ['forge', 'comments']).stdout, 'D1.1 reviewed: clean\nD1.2 reviewed: 2 findings, fixed in abc\n');
  assert.match(slipway(wt, ['forge', 'run']).stdout, /^off: forge none runs no CI$/m);
  const r = slipway(wt, ['forge', 'merge']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^merged lane\/D1 into main/m);
  const parents = git(repo, 'rev-list', '--parents', '-n', '1', 'main').split(' ');
  assert.equal(parents.length, 3, 'a merge commit');
  assert.equal(parents[2], git(wt, 'rev-parse', 'HEAD'));
  assert.equal(git(origin, 'rev-parse', 'main'), parents[0], 'pushed');
  assert.equal(git(repo, 'log', '-1', '--format=%s', `${parents[0]}^1`), 'elsewhere');
  // Removed from inside the worktree, the lane's branch goes from origin too, forge or none.
  assert.equal(slipway(wt, ['worktree', 'remove', 'D1']).code, 0);
  assert.equal(git(origin, 'branch', '--list', 'lane/D1'), '');
  assert.equal(existsSync(file), false, 'the lane’s local comments go with it');
});

test('forge github goes through gh: an open pull request is reused, and a run is read on the pushed head', (t) => {
  const { repo } = ready(t, 'github');
  git(repo, 'checkout', '-q', '-b', 'lane/D2');
  git(repo, 'push', '-q', '-u', 'origin', 'lane/D2');
  const opened = path.join(path.dirname(repo), 'pr-open.log');
  mkdirSync(path.join(repo, 'docs/plan'), { recursive: true });
  writeFileSync(path.join(repo, 'docs/plan/D2.md'), PLAN);
  // A lane with no commit of its own gets no pull request yet: the forge would refuse an empty one.
  const fake0 = path.join(path.dirname(repo), 'gh0.mjs');
  writeFileSync(fake0, `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(opened)}, process.argv.slice(2).join(' ') + '\\n'); if (process.argv[3] === 'list') console.log('[]');\n`);
  let r0 = slipway(repo, ['forge', 'pr-open', '--plan', 'docs/plan/D2.md'], { env: { SLIPWAY_GH: fake0 } });
  assert.equal(r0.code, 0, r0.stderr);
  assert.match(r0.stdout, /^no commits on lane\/D2 beyond main yet: the pull request opens with the first step$/m);
  assert.doesNotMatch(readFileSync(opened, 'utf8'), /pr create/);
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: D2.1 things');
  git(repo, 'push', '-q', 'origin', 'lane/D2');
  // --branch acts on a branch this checkout does not have checked out.
  git(repo, 'checkout', '-q', 'main');
  r0 = slipway(repo, ['forge', 'comments', '--branch', 'lane/D2'], { env: { SLIPWAY_GH: fake0 } });
  assert.match(readFileSync(opened, 'utf8'), /^pr view lane\/D2 --json comments$/m, r0.stderr);
  git(repo, 'checkout', '-q', 'lane/D2');
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
else if (args[0] === 'pr' && args[1] === 'view') console.log(JSON.stringify({ comments: [{ body: 'D2.1 reviewed: clean\\n\\nbody' }, { body: 'note' }] }));
`,
  );
  const env = { SLIPWAY_GH: fake };
  let r = slipway(repo, ['forge', 'pr-open', '--plan', 'docs/plan/D2.md', '--title', 'D2 — Things'], { env });
  assert.equal(r.stdout.trim(), 'https://github.com/o/r/pull/9', r.stderr);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.at(-1).slice(0, 9), ['pr', 'create', '--draft', '--base', 'main', '--head', 'lane/D2', '--title', 'D2 — Things']);
  r = slipway(repo, ['forge', 'pr-open', '--plan', 'docs/plan/D2.md'], { env: { ...env, FAKE_OPEN: '[{"url":"https://github.com/o/r/pull/8"}]' } });
  assert.equal(r.stdout.trim(), 'https://github.com/o/r/pull/8');
  r = slipway(repo, ['forge', 'run', '--log'], { env });
  assert.equal(r.code, 1);
  assert.match(r.stdout, new RegExp(`^red ${head.slice(0, 12)} https://run/1\\nthe failing log$`, 'm'));
  const runList = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((c) => c[1] === 'list' && c[0] === 'run');
  assert.deepEqual(runList.slice(0, 4), ['run', 'list', '--commit', head]);
  r = slipway(repo, ['forge', 'comments'], { env });
  assert.equal(r.stdout, 'D2.1 reviewed: clean\nnote\n', r.stderr);
});

test("pr-open --plan builds the body from the plan's goal, steps and CI line", (t) => {
  const { repo } = ready(t, 'github');
  git(repo, 'checkout', '-q', '-b', 'lane/D4');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'docs(plan): scope D4');
  git(repo, 'push', '-q', '-u', 'origin', 'lane/D4');
  mkdirSync(path.join(repo, 'docs/plan'), { recursive: true });
  const plan = PLAN.replace('Refund part of an order.', 'Refund part of an order.\n\n- the refund keeps the order <!-- why -->\n\nIn cents.').replace(
    '## Done when',
    '## Constraints\n\n- Money is integer cents.\n\n## Done when',
  );
  writeFileSync(path.join(repo, 'docs/plan/D4.md'), plan);
  const log = path.join(path.dirname(repo), 'gh.log');
  const fake = path.join(path.dirname(repo), 'gh.mjs');
  // The body file is gone after the call, so the stand-in records what it held.
  writeFileSync(
    fake,
    `import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const at = args.indexOf('--body-file');
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, body: at < 0 ? null : readFileSync(args[at + 1], 'utf8') }) + '\\n');
if (args[1] === 'list') console.log('[]');
else console.log('https://github.com/o/r/pull/4');
`,
  );
  const env = { SLIPWAY_GH: fake };
  const r = slipway(path.join(repo, 'docs'), ['forge', 'pr-open', '--plan', 'plan/D4.md'], { env });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'https://github.com/o/r/pull/4');
  const create = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.deepEqual(create.args.slice(0, 9), ['pr', 'create', '--draft', '--base', 'main', '--head', 'lane/D4', '--title', 'D4 — Refunds']);
  assert.equal(
    create.body,
    'Refund part of an order.\n\n- the refund keeps the order\n\nIn cents.\n\n## Steps\n\n1. The refund model\n2. The refund endpoint\n\nPlan: `docs/plan/D4.md` · CI: `at-ship`\n',
  );
  // The body comes from the plan alone: --body-file is not pr-open's.
  const bare = slipway(repo, ['forge', 'pr-open', '--title', 't', '--body-file', 'x.md'], { env });
  assert.equal(bare.code, 2);
  assert.match(bare.stderr, /pr-open takes no --body-file/);
  assert.match(slipway(repo, ['forge', 'pr-open', '--title', 't'], { env }).stderr, /pr-open needs --plan/);
  assert.match(slipway(repo, ['forge', 'pr-open', '--plan', 'docs/plan/D9.md'], { env }).stderr, /--plan .*D9\.md: no such file/);
  // Given beside --plan, --body-file is refused too, not ignored.
  const both = slipway(repo, ['forge', 'pr-open', '--plan', 'docs/plan/D4.md', '--body-file', 'x.md'], { env });
  assert.equal(both.code, 2);
  assert.match(both.stderr, /pr-open takes no --body-file/);
  // A plan outside the repository would put the folders around it in the body: refused.
  writeFileSync(path.join(repo, '..', 'D4.md'), plan);
  const outside = slipway(repo, ['forge', 'pr-open', '--plan', '../D4.md'], { env });
  assert.equal(outside.code, 2);
  assert.match(outside.stderr, /--plan .*D4\.md: not in this repository/);
});
