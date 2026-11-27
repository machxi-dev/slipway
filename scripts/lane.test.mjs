import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { addEntry, findLane, overlapWarnings, overlaps, removeEntry, skillsFor } from './lane.mjs';
import { git, slipway, tempRepo } from './testing.mjs';

const PLAN = readFileSync(new URL('./fixtures/plan.md', import.meta.url), 'utf8');
const read = (repo, p) => readFileSync(path.join(repo, p), 'utf8');
function ready(t) {
  const repo = tempRepo(t);
  assert.equal(slipway(repo, ['init', '--check', 'x']).code, 0);
  return repo;
}
const write = (repo, p, text) => {
  mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
  writeFileSync(path.join(repo, p), text);
};

/** ready(t), committed, with a bare origin that has main. */
function withOrigin(t) {
  const repo = ready(t);
  const origin = path.join(path.dirname(repo), 'origin.git');
  git(path.dirname(repo), 'init', '-q', '--bare', origin);
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return repo;
}

/** Commit files on a new branch from main and push it to origin, leaving neither the branch nor its remote ref here. */
function pushBranch(repo, branch, files) {
  git(repo, 'checkout', '-q', '-b', branch, 'main');
  for (const [p, text] of Object.entries(files)) write(repo, p, text);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', branch);
  git(repo, 'push', '-q', 'origin', branch);
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'branch', '-q', '-D', branch);
  git(repo, 'update-ref', '-d', `refs/remotes/origin/${branch}`);
}

const planD = (n, status = 'in progress') => PLAN.replace('# D4.', `# D${n}.`).replace('in progress', status).replace('lane/D4', `lane/D${n}`);

test('globs overlap when one literal prefix starts the other; skills come from the areas a step reaches', (t) => {
  assert.ok(overlaps('apps/api/**', 'apps/api/src/x.ts'));
  assert.ok(overlaps('apps/**', 'apps/api/**'));
  assert.ok(!overlaps('apps/api/**', 'apps/web/**'));
  const config = { areas: { api: { paths: ['apps/api/**'], skills: ['api-conventions'] }, web: { paths: ['apps/web/**'], skills: ['web', 'api-conventions'] } } };
  assert.deepEqual(skillsFor(config, '`apps/web/x/**`, apps/api/y.ts'), ['api-conventions', 'web']);
  assert.deepEqual(skillsFor(config, 'docs/**'), []);
  const sql = { areas: { sql: { paths: ['**/*.sql'], skills: ['sql-conventions'] } } };
  assert.deepEqual(skillsFor(sql, 'src/ui/button.tsx'), []);
  assert.deepEqual(skillsFor(sql, 'db/migrations/**/*.sql'), ['sql-conventions']);
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

test('the step brief prints each conventions skill\'s SKILL.md path, or that it is not found', (t) => {
  const repo = ready(t);
  const cfg = JSON.parse(read(repo, 'slipway.config.json'));
  cfg.areas = { api: { paths: ['src/api/**'], skills: ['api-conventions', 'plugin:elsewhere'] } };
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(cfg));
  writeFileSync(path.join(repo, 'docs/plan/D4.md'), PLAN);
  mkdirSync(path.join(repo, '.claude/skills/api-conventions'), { recursive: true });
  writeFileSync(path.join(repo, '.claude/skills/api-conventions/SKILL.md'), '---\nname: api-conventions\n---\n\nHandlers are thin.\n');
  git(repo, 'checkout', '-q', '-b', 'lane/D4');
  let r = slipway(repo, ['lane', '--step', 'next']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /### 2\. The refund endpoint/);
  assert.match(r.stdout, /^Conventions skills:\n- api-conventions: \.claude\/skills\/api-conventions\/SKILL\.md\n- plugin:elsewhere: not found in \.claude\/skills$/m);
  assert.match(r.stdout, /^Decisions file: docs\/plan\/D4\.decisions\.md$/m);
  assert.match(slipway(repo, ['lane', '--step', '1']).stdout, /^Conventions skills: none$/m, 'a step that reaches no area');
  r = slipway(repo, ['lane']);
  assert.match(r.stdout, /^steps: 1 of 2 built; next: 2\. The refund endpoint$/m);
  assert.match(r.stdout, /^status: in progress; CI: at-ship$/m);
});

test('the step brief prints the plan\'s constraints', (t) => {
  const repo = ready(t);
  git(repo, 'checkout', '-q', '-b', 'lane/D4');
  write(repo, 'docs/plan/D4.md', PLAN.replace('## Done when', '## Constraints\n\n- No ceiling rises in this lane.\n- Amounts are cents ([0003](../adr/0003-money.md)).\n\n## Done when'));
  let r = slipway(repo, ['lane', '--step', '2']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Refund part of an order\.\n\n## Constraints\n\n- No ceiling rises in this lane\.\n- Amounts are cents \(\[0003\]\(\.\.\/adr\/0003-money\.md\)\)\.\n\n### 2\. The refund endpoint\n/m, 'after the header, before the step');
  assert.doesNotMatch(r.stdout, /## Done when|### 1\./, 'and nothing else of the plan');
  // The template's section, left as a comment, is not printed.
  write(repo, 'docs/plan/D4.md', PLAN.replace('## Done when', '## Constraints\n\n<!-- One bullet each, citing the record it comes from. -->\n\n## Done when'));
  r = slipway(repo, ['lane', '--step', '2']);
  assert.doesNotMatch(r.stdout, /Constraints|One bullet/);
  assert.match(r.stdout, /^Refund part of an order\.\n\n### 2\. The refund endpoint\n/m);
});

test('the next deliverable counts the plans on the remote\'s lane branches', (t) => {
  const repo = withOrigin(t);
  assert.equal(slipway(repo, ['ledger', 'next']).stdout.trim(), 'D1');
  const roadmap = read(repo, 'docs/plan/ROADMAP.md').replace('## Candidates', '### D5 — Five\n\n## Candidates');
  pushBranch(repo, 'lane/D2', { 'docs/plan/D2.md': planD(2, 'planned'), 'docs/plan/ROADMAP.md': roadmap });
  pushBranch(repo, 'lane/D3', {});
  pushBranch(repo, 'topic/D40', { 'docs/plan/D40.md': planD(40) });
  assert.equal(git(repo, 'branch', '--list', '-r', 'origin/lane/*'), '', 'nothing here before the fetch');
  assert.equal(slipway(repo, ['ledger', 'next']).stdout.trim(), 'D6', 'the roadmap entry on lane/D2; topic/D40 is not a lane branch');
  pushBranch(repo, 'lane/D9', {});
  git(repo, 'remote', 'set-url', 'origin', path.join(path.dirname(repo), 'gone.git'));
  assert.equal(slipway(repo, ['ledger', 'next']).stdout.trim(), 'D6', 'a failed fetch reads the refs already here');
  git(repo, 'remote', 'remove', 'origin');
  assert.equal(slipway(repo, ['ledger', 'next']).stdout.trim(), 'D1', 'no remote, nothing read');
});

test('the ledger verbs add, open and ship a row, and the plan’s Status follows', (t) => {
  const repo = ready(t);
  assert.equal(slipway(repo, ['ledger', 'add', 'Refunds', '--scope', 'Refund part of an order.']).stdout.trim(), 'D1');
  assert.match(read(repo, 'docs/plan/ROADMAP.md'), /## Planned\n\n<!--[^]*-->\n\n### D1 — Refunds\n\nRefund part of an order\.\n\n## Candidates/);
  writeFileSync(path.join(repo, 'docs/plan/D1.md'), PLAN.replace('# D4.', '# D1.').replace('in progress', 'planned'));
  assert.equal(slipway(repo, ['ledger', 'set', 'D1', 'in progress']).stdout, 'wrote docs/plan/README.md\nwrote docs/plan/D1.md\n', 'names each file to commit');
  assert.match(read(repo, 'docs/plan/README.md'), /^\| \[D1\]\(D1\.md\) \| Refunds \| in progress \|$/m);
  assert.match(read(repo, 'docs/plan/D1.md'), /^- Status: in progress$/m);
  assert.equal(slipway(repo, ['ledger', 'set', 'D1', 'shipped']).code, 2);
  assert.equal(slipway(repo, ['ledger', 'ship', 'D1', '--pr', 'https://x/pull/3', '--date', '2026-11-27']).stdout, 'wrote docs/plan/SHIPPED.md\nwrote docs/plan/README.md\nwrote docs/plan/D1.md\nwrote docs/plan/ROADMAP.md\n');
  assert.doesNotMatch(read(repo, 'docs/plan/README.md'), /Refunds/);
  assert.match(read(repo, 'docs/plan/SHIPPED.md'), /^\| \[D1\]\(D1\.md\) \| Refunds \| 2026-11-27 \| https:\/\/x\/pull\/3 \|$/m);
  assert.match(read(repo, 'docs/plan/D1.md'), /^- Status: shipped 2026-11-27$/m);
  assert.match(read(repo, 'docs/plan/ROADMAP.md'), /## Planned\n\n<!--[^]*-->\n\n## Candidates/, 'the shipped row leaves the roadmap');
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

test('the overlap warning reads open plans on the remote\'s lane branches', (t) => {
  const repo = withOrigin(t);
  const config = loadConfig(repo);
  const migrating = (text) => text.replace('- CI:', '- Migrations: yes\n- CI:');
  pushBranch(repo, 'lane/D4', { 'docs/plan/D4.md': migrating(planD(4)) });
  pushBranch(repo, 'lane/D5', { 'docs/plan/D5.md': planD(5, 'planned') });
  // A copy of another lane's plan on a lane branch is not that lane's: lane/D7's own plan is.
  pushBranch(repo, 'lane/D7', { 'docs/plan/D7.md': planD(7, 'shipped 2026-11-27'), 'docs/plan/D8.md': planD(8) });
  write(repo, 'docs/plan/D6.md', migrating(planD(6, 'planned')));
  const expected = ['D6 and D4 (in progress) both name 0003-money.md, 0005-queue.md', 'D6 and D4 (in progress) both add migrations'];
  assert.deepEqual(overlapWarnings(repo, config, 6), expected);
  write(repo, 'docs/plan/D4.md', migrating(planD(4)));
  assert.deepEqual(overlapWarnings(repo, config, 6), expected, 'found here and on its branch, it counts once');
  const r = slipway(repo, ['lane', 'D6', '--overlap']);
  assert.equal(r.stdout, expected.map((w) => `warning: ${w}\n`).join(''));
});

test('a row is never lost when SHIPPED.md cannot take it', (t) => {
  const repo = ready(t);
  slipway(repo, ['ledger', 'add', 'Refunds']);
  writeFileSync(path.join(repo, 'docs/plan/SHIPPED.md'), '# Shipped, by hand\n');
  const r = slipway(repo, ['ledger', 'ship', 'D1']);
  assert.equal(r.code, 1);
  assert.match(read(repo, 'docs/plan/README.md'), /\| D1 \| Refunds \| planned \|/);
});

test('the table follows the plans: scope links a row, a row with no plan cannot open (§4.7)', (t) => {
  const repo = ready(t);
  slipway(repo, ['ledger', 'add', 'Refunds']);
  let r = slipway(repo, ['ledger', 'set', 'D1', 'in progress']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /D1 has no plan yet; \/slipway:scope writes docs\/plan\/D1\.md first/);
  assert.match(slipway(repo, ['ledger', 'set', 'D9', 'planned']).stderr, /no row D9: no open plan docs\/plan\/D9\.md and no "### D9 — <title>" entry/);
  writeFileSync(path.join(repo, 'docs/plan/D1.md'), PLAN.replace('# D4. Refunds', '# D1. Partial refunds').replace('in progress', 'planned'));
  assert.equal(slipway(repo, ['docs-check']).code, 1, 'a plan the table does not show yet is stale');
  assert.equal(slipway(repo, ['ledger', 'set', 'D1', 'planned']).stdout, 'wrote docs/plan/README.md\n', 'the plan was already planned');
  assert.match(read(repo, 'docs/plan/README.md'), /^\| \[D1\]\(D1\.md\) \| Partial refunds \| planned \|$/m, 'the plan’s title wins over the roadmap’s');
});

test('two lanes that open on their branches conflict only in the table, and regenerating resolves it (§4.5 step 2)', (t) => {
  const repo = ready(t);
  for (const title of ['One', 'Two', 'Three']) slipway(repo, ['ledger', 'add', title]);
  for (const n of [1, 2]) writeFileSync(path.join(repo, `docs/plan/D${n}.md`), PLAN.replace('# D4. Refunds', `# D${n}. ${['One', 'Two'][n - 1]}`).replace('in progress', 'planned').replace('lane/D4', `lane/D${n}`));
  for (const n of [1, 2]) slipway(repo, ['ledger', 'set', `D${n}`, 'planned']);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'scope D1 and D2');
  for (const n of [1, 2]) {
    git(repo, 'checkout', '-q', '-b', `lane/D${n}`, 'main');
    assert.equal(slipway(repo, ['ledger', 'set', `D${n}`, 'in progress']).code, 0);
    git(repo, 'commit', '-q', '-am', `open D${n}`);
  }
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'ship D1', 'lane/D1');
  git(repo, 'checkout', '-q', 'lane/D2');
  assert.throws(() => git(repo, 'merge', '-q', 'main'), 'adjacent rows conflict');
  assert.deepEqual(git(repo, 'diff', '--name-only', '--diff-filter=U').split('\n'), ['docs/plan/README.md']);
  assert.equal(slipway(repo, ['ledger', 'generate']).stdout, 'wrote docs/plan/README.md\n');
  assert.match(read(repo, 'docs/plan/README.md'), /\| --- \| --- \| --- \|\n\| \[D1\]\(D1\.md\) \| One \| in progress \|\n\| \[D2\]\(D2\.md\) \| Two \| in progress \|\n\| D3 \| Three \| planned \|\n$/);
  assert.equal(slipway(repo, ['ledger', 'generate', '--check']).code, 0);
});

test('with commands.format, the table is written through it and its padding is read back as the same rows', (t) => {
  const repo = ready(t);
  // A formatter that pads the table's cells, and pads them further each run, as no real one would.
  writeFileSync(path.join(repo, 'pad.mjs'), "import { readFileSync, writeFileSync } from 'node:fs';\nfor (const f of process.argv.slice(2)) writeFileSync(f, readFileSync(f, 'utf8').replace(/^\\|.*$/gm, (l) => l.replaceAll(' | ', '  |  ')));\n");
  const cfg = JSON.parse(read(repo, 'slipway.config.json'));
  cfg.commands.format = 'node pad.mjs';
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(cfg));
  slipway(repo, ['ledger', 'add', 'Refunds']);
  assert.match(read(repo, 'docs/plan/README.md'), /^\| D1  \|  Refunds  \|  planned \|$/m);
  assert.equal(slipway(repo, ['ledger', 'generate', '--check']).code, 0);
  slipway(repo, ['ledger', 'add', 'Returns']);
  assert.equal(slipway(repo, ['ledger', 'generate', '--check']).code, 0);
  assert.equal(slipway(repo, ['docs-check']).code, 0, slipway(repo, ['docs-check']).stderr);
});

test('roadmap entries go under "## Planned" exactly, in the file’s line ends, and leave from there at ship', () => {
  const roadmap = '# Roadmap\n\n## Planned work\n\n### D1 — Track note\n\n## Planned\n\n### D1 — One\n\n## Candidates\n';
  assert.equal(addEntry(roadmap, '### D2 — Two\n'), '# Roadmap\n\n## Planned work\n\n### D1 — Track note\n\n## Planned\n\n### D1 — One\n\n### D2 — Two\n\n## Candidates\n');
  assert.equal(addEntry(roadmap.replace(/\n/g, '\r\n'), '### D2 — Two\n'), addEntry(roadmap, '### D2 — Two\n').replace(/\n/g, '\r\n'));
  assert.equal(removeEntry(roadmap, 1), '# Roadmap\n\n## Planned work\n\n### D1 — Track note\n\n## Planned\n\n## Candidates\n');
  assert.equal(removeEntry('# Roadmap\n\n## Tracks\n\n### D3 — X\n\n## Planned\n', 3), '# Roadmap\n\n## Tracks\n\n## Planned\n', 'else the first anywhere, as before');
  assert.equal(removeEntry(roadmap, 9), null);
});

test('a failing formatter leaves every file as it was', (t) => {
  const repo = ready(t);
  slipway(repo, ['ledger', 'add', 'Refunds']);
  const before = ['README.md', 'ROADMAP.md', 'SHIPPED.md'].map((f) => read(repo, `docs/plan/${f}`));
  const cfg = JSON.parse(read(repo, 'slipway.config.json'));
  cfg.commands.format = 'node -e "process.exit(3)"';
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(cfg));
  for (const args of [['ledger', 'add', 'Returns'], ['ledger', 'ship', 'D1']]) {
    const r = slipway(repo, args);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /commands\.format failed on docs\/plan\/README\.md/);
    assert.deepEqual(['README.md', 'ROADMAP.md', 'SHIPPED.md'].map((f) => read(repo, `docs/plan/${f}`)), before);
  }
});

test('a number in SHIPPED.md never comes back as a planned row', (t) => {
  const repo = ready(t);
  slipway(repo, ['ledger', 'add', 'Refunds']);
  assert.equal(slipway(repo, ['ledger', 'ship', 'D1', '--date', '2026-11-27']).code, 0);
  const roadmap = path.join(repo, 'docs/plan/ROADMAP.md');
  writeFileSync(roadmap, read(repo, 'docs/plan/ROADMAP.md').replace('## Candidates', '### D1 — Refunds, again\n\n## Candidates'));
  assert.equal(slipway(repo, ['ledger', 'generate', '--check']).code, 0);
  assert.doesNotMatch(read(repo, 'docs/plan/README.md'), /Refunds/);
});
