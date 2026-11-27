import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseRules } from './digest.mjs';
import { git, slipway, tempRepo } from './testing.mjs';

const read = (repo, p) => readFileSync(path.join(repo, p), 'utf8');
function ready(t, areas) {
  const repo = tempRepo(t);
  assert.equal(slipway(repo, ['init', '--check', 'x']).code, 0);
  if (areas) {
    const cfg = JSON.parse(read(repo, 'slipway.config.json'));
    cfg.areas = areas;
    writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(cfg, null, 2));
  }
  return repo;
}
const record = (repo, file, status, rules) =>
  writeFileSync(path.join(repo, 'docs/adr', file), `# ${file.slice(0, 4)}. X\n\n- Status: ${status}\n- Date: 2026-11-27\n\n## Decision\n\nX.\n\n## Rules\n\n${rules}\n`);

test('rules are read with their topic, continuation lines, with and areas', () => {
  const rules = parseRules('## Rules\n\n<!-- - **No.** commented out -->\n- **Money.** Store cents\n  as integers. (with: 0001, 3) (areas: api)\n- not a rule\n\n## After\n\n- **Ignored.** x\n');
  assert.deepEqual(rules, [
    { line: 4, topic: 'Money.', text: 'Store cents as integers.', with: ['0001', '3'], areas: ['api'] },
    { line: 6, malformed: true, raw: 'not a rule' },
  ]);
});

test('`slipway digest` writes one digest per area from accepted records only, citing each record', (t) => {
  const repo = ready(t, { api: { paths: ['api/**'] }, web: { paths: ['web/**'] } });
  record(repo, '0002-money.md', 'accepted', '- **Money.** Store cents. (areas: api, web)');
  record(repo, '0003-draft.md', 'proposed', '- **Draft.** Not yet.');
  record(repo, '0004-queue.md', 'accepted', '- **Queue.** One consumer. (with: 0002) (areas: api)');
  const r = slipway(repo, ['digest']);
  assert.equal(r.code, 0, r.stderr);
  const api = read(repo, 'docs/rules/api.md');
  assert.match(api, /^- \*\*Money\.\*\* Store cents\. \(\[0002\]\(\.\.\/adr\/0002-money\.md\)\)$/m);
  assert.match(api, /^- \*\*Queue\.\*\* One consumer\. \(\[0004\]\(\.\.\/adr\/0004-queue\.md\), with \[0002\]\(\.\.\/adr\/0002-money\.md\)\)$/m);
  assert.match(read(repo, 'docs/rules/web.md'), /Money/);
  assert.doesNotMatch(read(repo, 'docs/rules/general.md'), /Draft|Money/);
  assert.match(read(repo, 'docs/rules/general.md'), /\*\*Commands\.\*\*/, 'the process record’s rules');
  assert.equal(slipway(repo, ['digest', '--check']).code, 0);
  writeFileSync(path.join(repo, 'docs/rules/api.md'), 'edited by hand\n');
  const c = slipway(repo, ['digest', '--check']);
  assert.equal(c.code, 1);
  assert.match(c.stdout, /^stale docs\/rules\/api\.md$/m);
  assert.equal(read(repo, 'docs/rules/api.md'), 'edited by hand\n', 'a check writes nothing');
});

test('a rule citing a record out of force, or an unknown area, is refused and nothing is written', (t) => {
  const repo = ready(t);
  record(repo, '0002-a.md', 'superseded by [0003](0003-b.md)', '- **A.** a.');
  record(repo, '0003-b.md', 'accepted', '- **B.** b. (with: 2) (areas: nowhere)');
  const before = read(repo, 'docs/rules/general.md');
  const r = slipway(repo, ['digest']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /0003-b\.md:\d+: \(with: 2\) cites 0002-a\.md, which is superseded/);
  assert.match(r.stderr, /\(areas: nowhere\) is not an area/);
  assert.equal(read(repo, 'docs/rules/general.md'), before);
});

test('with commands.format, the digest is compared after the formatter (§3.3)', (t) => {
  const repo = ready(t);
  // The formatter appends a marker line, as a real one would change spacing.
  writeFileSync(path.join(repo, 'fmt.mjs'), "import { appendFileSync } from 'node:fs';\nfor (const f of process.argv.slice(2)) appendFileSync(f, '<!-- formatted -->\\n');\n");
  const cfg = JSON.parse(read(repo, 'slipway.config.json'));
  cfg.commands.format = 'node fmt.mjs';
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(cfg));
  assert.equal(slipway(repo, ['digest']).code, 0);
  assert.match(read(repo, 'docs/rules/general.md'), /<!-- formatted -->\n$/);
  const before = read(repo, 'docs/rules/general.md');
  assert.equal(slipway(repo, ['digest', '--check']).code, 0);
  assert.equal(read(repo, 'docs/rules/general.md'), before, 'the check puts the committed bytes back');
  git(repo, 'status');
});
