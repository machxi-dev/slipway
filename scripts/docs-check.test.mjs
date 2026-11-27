import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { git, slipway, tempRepo } from './testing.mjs';

const PLAN = readFileSync(new URL('./fixtures/plan.md', import.meta.url), 'utf8');
const read = (repo, p) => readFileSync(path.join(repo, p), 'utf8');
const write = (repo, p, text) => {
  mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
  writeFileSync(path.join(repo, p), text);
};
function ready(t, extra = {}) {
  const repo = tempRepo(t);
  assert.equal(slipway(repo, ['init', '--check', 'x']).code, 0);
  const cfg = { ...JSON.parse(read(repo, 'slipway.config.json')), ...extra };
  write(repo, 'slipway.config.json', JSON.stringify(cfg, null, 2));
  return repo;
}
const check = (repo) => {
  const r = slipway(repo, ['docs-check']);
  return { code: r.code, problems: r.stderr.split('\n').filter((l) => l && !l.startsWith('docs-check:')), out: r.stdout };
};
/** An open lane D4 with its plan, its row and its records. */
function lane(repo) {
  write(repo, 'docs/adr/0003-money.md', '# 0003. Money\n\n- Status: proposed\n');
  write(repo, 'docs/adr/0005-queue.md', '# 0005. Queue\n\n- Status: proposed\n');
  write(repo, 'docs/plan/D4.md', PLAN);
  const ledger = read(repo, 'docs/plan/README.md');
  write(repo, 'docs/plan/README.md', `${ledger.trimEnd()}\n| [D4](D4.md) | Refunds | in progress |\n`);
}

test('a repository fresh from init passes', (t) => {
  const repo = ready(t);
  const r = check(repo);
  assert.equal(r.code, 0, r.problems.join('\n'));
  assert.match(r.out, /^docs-check: ok \(\d+ files\)$/m);
});

test('an open lane in shape passes; its ledger row and plan must agree', (t) => {
  const repo = ready(t);
  lane(repo);
  assert.equal(check(repo).code, 0, check(repo).problems.join('\n'));
  write(repo, 'docs/plan/D4.md', PLAN.replace('- Status: in progress', '- Status: planned'));
  assert.deepEqual(check(repo).problems, ['docs/plan/README.md:20: D4 is in progress, but its plan says planned']);
});

test('plans out of shape are refused, naming file and line', (t) => {
  const repo = ready(t, { forge: 'none', ci: { default: 'off' } });
  lane(repo);
  write(
    repo,
    'docs/plan/D4.md',
    PLAN.replace('### 2. The refund endpoint', '### 2. Close-out')
      .replace('- Done when: `api.test › POST /refunds` passes <!-- a comment -->', '- Done when: `slipway run gate` is green.')
      .replace('[0005](../adr/0005-queue.md)', '[0009](../adr/0009-gone.md)')
      .replace('- Branch: `lane/D4`\n', '- Release: huge\n'),
  );
  assert.deepEqual(check(repo).problems, [
    'docs/plan/D4.md:5: CI must be off when forge is none (§4.6)',
    'docs/plan/D4.md:6: a Release line needs a release block in slipway.config.json',
    'docs/plan/D4.md: an in-progress plan needs a "- Branch:" line',
    'docs/plan/D4.md:4: record link ../adr/0009-gone.md does not resolve',
    'docs/plan/D4.md:23: step 2 is a close-out; every step builds (§2)',
    "docs/plan/D4.md:23: step 2's done-when is the definition of done, which is the ship's",
  ]);
});

test('a shipped plan with an open decisions line is refused; a line in no known shape always is (§4.3)', (t) => {
  const repo = ready(t);
  lane(repo);
  write(repo, 'docs/plan/D4.decisions.md', '# D4 decisions\n\n- Provisional (D4.2): took cents; declined floats; overturning costs a migration.\n- took 404\n');
  assert.deepEqual(check(repo).problems, ['docs/plan/D4.decisions.md:4: a line is "- Provisional (D<n>.<step>): …" or "- Owed (D<n>.<step>): …"']);
  assert.equal(slipway(repo, ['ledger', 'ship', 'D4']).code, 0);
  assert.deepEqual(check(repo).problems, [
    'docs/plan/D4.decisions.md:3: D4 shipped with this line open; mark it Ratified, Overturned or Paid',
    'docs/plan/D4.decisions.md:4: a line is "- Provisional (D<n>.<step>): …" or "- Owed (D<n>.<step>): …"',
  ]);
});

test('the 120-word cap holds only for records this branch adds or changes (§14)', (t) => {
  const repo = ready(t);
  const long = `- **Long.** ${'word '.repeat(130).trim()}.`;
  write(repo, 'docs/adr/0002-old.md', `# 0002. Old\n\n- Status: proposed\n\n## Rules\n\n${long}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'old');
  git(repo, 'checkout', '-q', '-b', 'lane/D1');
  assert.equal(check(repo).code, 0, check(repo).problems.join('\n'));
  write(repo, 'docs/adr/0003-new.md', `# 0003. New\n\n- Status: proposed\n\n## Rules\n\n${long}\n`);
  assert.deepEqual(check(repo).problems, ['docs/adr/0003-new.md:7: rule "Long." is 131 words; the cap is 120']);
});

test('a stale digest is refused', (t) => {
  const repo = ready(t);
  write(repo, 'docs/rules/general.md', 'by hand\n');
  assert.deepEqual(check(repo).problems, ['docs/rules/general.md: differs from what slipway digest writes; run it']);
});

test('specs need scenarios with WHEN and THEN, and a Proved by: that exists', (t) => {
  const repo = ready(t);
  write(repo, 'test/refund.test.js', '');
  write(
    repo,
    'docs/specs/refunds.md',
    [
      '# Refunds',
      '',
      '## Requirement: a refund rounds down',
      '',
      'Proved by: `test/refund.test.js › rounds down`',
      '',
      '### Scenario: a third of a cent',
      '',
      '- WHEN 1 cent is split three ways',
      '- THEN each part is 0 cents',
      '',
      '## Requirement: a refund is logged',
      '',
      'Proved by: `test/missing.test.js`',
      '',
      '### Scenario: no then',
      '',
      '- WHEN a refund is made',
      '',
    ].join('\n'),
  );
  assert.deepEqual(check(repo).problems, [
    'docs/specs/refunds.md:16: a scenario needs a WHEN and a THEN line',
    'docs/specs/refunds.md:14: Proved by: test/missing.test.js does not exist',
  ]);
});

test('budgets: a path beats a glob, the lower of two globs holds, a path naming no file is refused (§14)', (t) => {
  const repo = ready(t);
  write(repo, 'notes/a.md', 'x'.repeat(50));
  write(repo, 'notes/big.md', 'x'.repeat(50));
  const budget = JSON.parse(read(repo, 'slipway.budget.json'));
  Object.assign(budget, { 'notes/*.md': 100, 'notes/a*': 40, 'notes/big.md': 60, 'notes/gone.md': 10, 'docs/x/*.md': 5, 'bad.md': -1 });
  write(repo, 'slipway.budget.json', JSON.stringify(budget));
  assert.deepEqual(check(repo).problems, [
    'slipway.budget.json: notes/gone.md: names no file; remove the entry',
    'slipway.budget.json: bad.md: a ceiling is a positive whole number of bytes',
    'notes/a.md: 50 bytes, over its ceiling of 40 in slipway.budget.json',
  ]);
});

test('with commands.format, the digests init writes are already formatted, so the first docs-check passes', (t) => {
  const repo = tempRepo(t);
  write(repo, 'fmt.mjs', "import { appendFileSync } from 'node:fs';\nfor (const f of process.argv.slice(2)) appendFileSync(f, '<!-- formatted -->\\n');\n");
  write(repo, 'slipway.config.json', JSON.stringify({ version: 1, tagPrefix: 'x', commands: { check: 'c', 'step-check': 's', gate: 'g', format: 'node fmt.mjs' } }));
  assert.equal(slipway(repo, ['init']).code, 0);
  assert.match(read(repo, 'docs/rules/general.md'), /<!-- formatted -->\n$/);
  const r = check(repo);
  assert.equal(r.code, 0, r.problems.join('\n'));
});
