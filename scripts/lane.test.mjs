import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { findLane, overlapWarnings, overlaps, skillsFor } from './lane.mjs';
import { git, slipway, tempRepo } from './testing.mjs';

const PLAN = readFileSync(new URL('./fixtures/plan.md', import.meta.url), 'utf8');
const read = (repo, p) => readFileSync(path.join(repo, p), 'utf8');
function ready(t) {
  const repo = tempRepo(t);
  assert.equal(slipway(repo, ['init', '--check', 'x']).code, 0);
  return repo;
}

test('globs overlap when one literal prefix starts the other; skills come from the areas a step reaches', (t) => {
  assert.ok(overlaps('apps/api/**', 'apps/api/src/x.ts'));
  assert.ok(overlaps('apps/**', 'apps/api/**'));
  assert.ok(!overlaps('apps/api/**', 'apps/web/**'));
  const config = { areas: { api: { paths: ['apps/api/**'], skills: ['api-conventions'] }, web: { paths: ['apps/web/**'], skills: ['web', 'api-conventions'] } } };
  assert.deepEqual(skillsFor(config, '`apps/web/x/**`, apps/api/y.ts'), ['api-conventions', 'web']);
  assert.deepEqual(skillsFor(config, 'docs/**'), []);
});

test('the lane comes from the branch, else from a plan whose Branch line names it (§14)', (t) => {
  const repo = ready(t);
  const config = loadConfig(repo);
  writeFileSync(path.join(repo, 'docs/plan/D4.md'), PLAN.replace('`lane/D4`', '`claude/given-branch`'));
  assert.throws(() => findLane(repo, config), /is not a lane; name the lane as D<n>/);
  git(repo, 'checkout', '-q', '-b', 'lane/D4');
  assert.equal(findLane(repo, config).n, 4);
  git(repo, 'checkout', '-q', '-b', 'claude/given-branch');
  const lane = findLane(repo, config);
  assert.equal(lane.n, 4);
  assert.equal(lane.branch, 'claude/given-branch');
  assert.equal(lane.planFile, 'docs/plan/D4.md');
  assert.equal(findLane(repo, config, 'D4.2').k, 2);
  assert.throws(() => findLane(repo, config, 'four'), /not a deliverable/);
});

test('`slipway lane --step` prints the header, the step and its conventions skills', (t) => {
  const repo = ready(t);
  const cfg = JSON.parse(read(repo, 'slipway.config.json'));
  cfg.areas = { api: { paths: ['src/api/**'], skills: ['api-conventions'] } };
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(cfg));
  writeFileSync(path.join(repo, 'docs/plan/D4.md'), PLAN);
  git(repo, 'checkout', '-q', '-b', 'lane/D4');
  let r = slipway(repo, ['lane', '--step', 'next']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /### 2\. The refund endpoint/);
  assert.match(r.stdout, /^Conventions skills: api-conventions$/m);
  assert.match(r.stdout, /^Decisions file: docs\/plan\/D4\.decisions\.md$/m);
  r = slipway(repo, ['lane']);
  assert.match(r.stdout, /^steps: 1 of 2 built; next: 2\. The refund endpoint$/m);
  assert.match(r.stdout, /^status: in progress; CI: at-ship$/m);
});

test('the ledger verbs add, open and ship a row, and the plan’s Status follows', (t) => {
  const repo = ready(t);
  assert.equal(slipway(repo, ['ledger', 'add', 'Refunds', '--scope', 'Refund part of an order.']).stdout.trim(), 'D1');
  assert.match(read(repo, 'docs/plan/ROADMAP.md'), /## Planned\n\n<!--[^]*-->\n\n### D1 — Refunds\n\nRefund part of an order\.\n\n## Candidates/);
  writeFileSync(path.join(repo, 'docs/plan/D1.md'), PLAN.replace('# D4.', '# D1.').replace('in progress', 'planned'));
  assert.equal(slipway(repo, ['ledger', 'set', 'D1', 'in progress']).code, 0);
  assert.match(read(repo, 'docs/plan/README.md'), /^\| \[D1\]\(D1\.md\) \| Refunds \| in progress \|$/m);
  assert.match(read(repo, 'docs/plan/D1.md'), /^- Status: in progress$/m);
  assert.equal(slipway(repo, ['ledger', 'set', 'D1', 'shipped']).code, 2);
  assert.equal(slipway(repo, ['ledger', 'ship', 'D1', '--pr', 'https://x/pull/3', '--date', '2026-11-27']).code, 0);
  assert.doesNotMatch(read(repo, 'docs/plan/README.md'), /Refunds/);
  assert.match(read(repo, 'docs/plan/SHIPPED.md'), /^\| \[D1\]\(D1\.md\) \| Refunds \| 2026-11-27 \| https:\/\/x\/pull\/3 \|$/m);
  assert.match(read(repo, 'docs/plan/D1.md'), /^- Status: shipped 2026-11-27$/m);
  assert.equal(slipway(repo, ['ledger', 'next']).stdout.trim(), 'D2');
});

test('scope warns when an open lane names the same record, or both add migrations (§4.2)', (t) => {
  const repo = ready(t);
  const config = loadConfig(repo);
  writeFileSync(path.join(repo, 'docs/plan/D4.md'), PLAN.replace('- CI:', '- Migrations: yes\n- CI:'));
  writeFileSync(path.join(repo, 'docs/plan/D6.md'), PLAN.replace('# D4.', '# D6.').replace('in progress', 'planned').replace('- CI:', '- Migrations: yes\n- CI:'));
  assert.deepEqual(overlapWarnings(repo, config, 6), [
    'D6 and D4 (in progress) both name 0003-money.md, 0005-queue.md',
    'D6 and D4 (in progress) both add migrations',
  ]);
});
