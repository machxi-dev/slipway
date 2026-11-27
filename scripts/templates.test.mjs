// The templates `init`, `scope` and `adr` copy: shapes the design fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { normalize } from './config.mjs';
import { render } from './init.mjs';
import { PLUGIN_ROOT } from './testing.mjs';

const template = (name) => readFileSync(path.join(PLUGIN_ROOT, 'templates', name), 'utf8');
const headings = (md) => [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

test('§13.1 lists these templates', () => {
  assert.deepEqual(readdirSync(path.join(PLUGIN_ROOT, 'templates')).sort(), [
    'claude-md.md',
    'decisions.md',
    'digest.md',
    'ledger.md',
    'plan.md',
    'process-record.md',
    'readme-setup.md',
    'record.md',
    'records-index.md',
    'roadmap.md',
    'rules-loader.md',
    'settings-fragment.json',
    'shipped.md',
    'slipway.config.json',
  ]);
});

test('the settings fragment is what `claude plugin marketplace add` and `install --scope project` write', () => {
  // Recorded from Claude Code 2.1.332 on 2026-11-27 in an empty repository.
  assert.deepEqual(JSON.parse(template('settings-fragment.json')), {
    extraKnownMarketplaces: { slipway: { source: { source: 'github', repo: 'machxi-dev/slipway' } } },
    enabledPlugins: { 'slipway@slipway': true },
  });
});

test('the config template is valid once its three commands are named', () => {
  const raw = JSON.parse(template('slipway.config.json'));
  raw.commands = { check: 'a', 'step-check': 'b', gate: 'c' };
  assert.equal(normalize(raw).version, 1);
});

test('a record has the status and date lines and the §11 sections, Rules last (§5.2)', () => {
  const r = render(template('record.md'), { id: '0003', title: 'Queue', date: '2026-11-27' });
  assert.match(r, /^# 0003\. Queue\n\n- Status: proposed\n- Date: 2026-11-27\n/);
  assert.deepEqual(headings(r), ['Context', 'Decision', 'Consequences', 'Alternatives', 'Rules']);
});

test('a plan header carries Status, Records and CI; done-whens and steps are checkboxes (§4.1, §4.6)', () => {
  const p = template('plan.md');
  for (const line of ['- Status: planned', '- Records: {{records}}', '- CI: {{ci}}']) assert.ok(p.includes(`\n${line}\n`), line);
  assert.ok(p.includes('\n- Branch: `{{branch}}`\n'));
  assert.deepEqual(headings(p), ['Constraints', 'Done when', 'Steps', 'Asked at scope']);
  assert.match(p, /^- Done when: /m);
  assert.match(p, /^- \[ \] /m);
});

test('the ledger states the four window rules and the open-lanes sentence (§4.2, §4.7)', () => {
  const l = template('ledger.md');
  assert.equal([...l.matchAll(/^\d\. /gm)].length, 4);
  assert.match(l, /The open lanes are the `in progress` rows\./);
  assert.match(l, /^\| D \| Title \| Status \|$/m);
});

test("the process template carries the process record's rules", () => {
  // The template is the first record of a new repository, so it cites no parent: `(with: …)` is the record's own.
  const rules = (md) =>
    md
      .replace(/\r\n/g, '\n')
      .split(/^## Rules\n/m)[1]
      .trim()
      .split('\n')
      .map((l) => l.replace(/ \(with: [^)]*\)$/, ''));
  const { docs } = JSON.parse(template('slipway.config.json'));
  const filled = render(template('process-record.md'), { plans: docs.plans, digests: docs.digests, id: '0001', status: 'accepted', date: '2026-11-27' });
  assert.doesNotMatch(filled, /\{\{\w+\}\}/);
  const recordsDir = path.join(PLUGIN_ROOT, JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'slipway.config.json'), 'utf8')).docs.records);
  const process = readdirSync(recordsDir)
    .filter((f) => /^\d+-the-process\.md$/.test(f))
    .map((f) => readFileSync(path.join(recordsDir, f), 'utf8'))
    .filter((r) => /^- Status: accepted$/m.test(r));
  assert.equal(process.length, 1, 'one accepted process record');
  assert.deepEqual(rules(filled), rules(process[0]));
});

test('render fills known placeholders and leaves unknown ones for a later pass', () => {
  assert.equal(render('{{a}} {{b}}', { a: 1 }), '1 {{b}}');
});
