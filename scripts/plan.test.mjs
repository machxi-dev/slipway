import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDecisions, parsePlan, setHeader, stepText, tickStep } from './plan.mjs';
import { render } from './init.mjs';
import { PLUGIN_ROOT } from './testing.mjs';

const PLAN = readFileSync(new URL('./fixtures/plan.md', import.meta.url), 'utf8');

test('a plan’s header, definition of done and steps are read', () => {
  const p = parsePlan(PLAN);
  assert.equal(p.n, 4);
  assert.equal(p.title, 'Refunds');
  assert.equal(p.header.CI, 'at-ship');
  assert.equal(p.header.Branch, '`lane/D4`');
  assert.deepEqual(p.dod.map((d) => d.text), ['`slipway run gate` is green.']);
  assert.deepEqual(p.steps.map((s) => [s.k, s.title, s.built]), [[1, 'The refund model', true], [2, 'The refund endpoint', false]]);
  assert.equal(p.steps[1].fields['Done when'], '`api.test › POST /refunds` passes');
  assert.equal(p.steps[1].fields.Paths, 'src/api/**, web/refunds/**');
});

test('a step’s text is the header and that step’s section only (§4.4)', () => {
  const t = stepText(parsePlan(PLAN), 2);
  assert.ok(t.startsWith('# D4. Refunds\n\n- Status: in progress\n'));
  assert.match(t, /### 2\. The refund endpoint/);
  assert.doesNotMatch(t, /The refund model|Done when\n\n- \[ \]|Asked at scope/);
  assert.equal(stepText(parsePlan(PLAN), 9), null);
});

test('a step is ticked and a header line set in place', () => {
  const t = tickStep(PLAN, 2);
  assert.equal(parsePlan(t).steps[1].built, true);
  assert.equal(t.split('\n').length, PLAN.split('\n').length);
  assert.match(setHeader(PLAN, 'Status', 'shipped 2026-11-27'), /^- Status: shipped 2026-11-27$/m);
  assert.throws(() => setHeader(PLAN, 'Nope', 'x'), /no "- Nope:" line/);
});

test('the plan template parses once rendered', () => {
  const p = parsePlan(render(readFileSync(`${PLUGIN_ROOT}/templates/plan.md`, 'utf8'), { n: 7, title: 'X', records: 'none', ci: 'on', branch: 'lane/D7', goal: 'G', 'first step': 'S' }));
  assert.equal(p.n, 7);
  assert.deepEqual(Object.keys(p.header), ['Status', 'Records', 'CI', 'Branch']);
  assert.equal(p.steps.length, 1);
  assert.equal(p.steps[0].built, false);
});

test('decisions lines are read by shape; marks close them; anything else is malformed (§4.3)', () => {
  const d = parseDecisions(`# D4 decisions

<!--
- Provisional (D4.<step>): an example in a comment.
-->
- Provisional (D4.2): took cents; declined floats; overturning costs a migration.
- Provisional (D4.2): took 404; declined 410; overturning costs a client change. Ratified 2026-11-27.
- Owed (D4.1): a load test, before ship. Paid D5.1
- Overturned 2026-11-27, something.
`);
  assert.deepEqual(d.map((x) => [x.line, x.kind ?? 'malformed', x.open ?? null]), [
    [6, 'Provisional', true],
    [7, 'Provisional', false],
    [8, 'Owed', false],
    [9, 'malformed', null],
  ]);
});
