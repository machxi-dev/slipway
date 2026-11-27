import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_HEADER, cells, conflictsOutside, hasTable, ledgerRows, normalizeStatus, readRows, removeRow, renderLedger, roadmapEntries, rowLine, sameRows, setRow, splitLegacy, tableSpan } from './ledger.mjs';

const ledger = `# Ledger\n\n${LEDGER_HEADER}\n| --- | --- | --- |\n`;

test('a status is read from the cell’s first word; anything else is unread, never guessed', () => {
  assert.equal(normalizeStatus('**Shipped** 2026-10-01'), 'shipped');
  assert.equal(normalizeStatus('✅ done'), 'shipped');
  assert.equal(normalizeStatus('In-progress'), 'in progress');
  assert.equal(normalizeStatus('planned (after D2 is done)'), 'planned');
  assert.equal(normalizeStatus('not done'), null);
  assert.equal(normalizeStatus('reopened'), null);
});

test('cells honour an escaped pipe, and a row written back escapes it once', () => {
  assert.deepEqual(cells('| D3 | Import \\| export | planned |'), ['D3', 'Import | export', 'planned']);
  assert.equal(rowLine({ n: 3, title: 'Import | export', status: 'planned', link: null }), '| D3 | Import \\| export | planned |');
});

test('rows are set in number order, replaced by number, and removed', () => {
  let l = setRow(ledger, { n: 12, title: 'Twelve', status: 'planned', link: 'D12.md' });
  l = setRow(l, { n: 3, title: 'Three', status: 'planned', link: null });
  l = setRow(l, { n: 12, title: 'Twelve', status: 'in progress', link: 'D12.md' });
  assert.ok(l.endsWith('| --- | --- | --- |\n| D3 | Three | planned |\n| [D12](D12.md) | Twelve | in progress |\n'), l);
  assert.deepEqual(readRows(l).map((r) => [r.n, r.status, r.link]), [[3, 'planned', null], [12, 'in progress', 'D12.md']]);
  assert.ok(!removeRow(l, 3).includes('Three'));
  assert.throws(() => setRow('# nothing\n', { n: 1, title: 'x', status: 'planned' }), /no "\| D \| Title \| Status \|" table/);
});

test('an old ledger with tables of other kinds keeps those tables in the rest', () => {
  const s = splitLegacy('# Plan\n\n| Track | Owner |\n| --- | --- |\n| api | me |\n\n| D | Title | Status |\n|---|---|---|\n| D1 | One | shipped |\n');
  assert.deepEqual(s.shipped.map((r) => r.n), [1]);
  assert.equal(s.rest, '| Track | Owner |\n| --- | --- |\n| api | me |');
});

test('the table is found by its cells, so a formatter’s padding is no matter', () => {
  const padded = '# L\n\n| D    | Title | Status      |\n| ---- | ----- | ----------- |\n| [D2](D2.md) | Two   | in progress |\n';
  assert.deepEqual(readRows(padded).map((r) => [r.n, r.title, r.status, r.link]), [[2, 'Two', 'in progress', 'D2.md']]);
  assert.ok(sameRows(padded, [{ n: 2, title: 'Two', status: 'in progress', link: 'D2.md' }]));
  assert.ok(!sameRows(padded, [{ n: 2, title: 'Two', status: 'planned', link: 'D2.md' }]));
  assert.ok(hasTable(padded) && !hasTable('# L\n\n| D | Title |\n'));
});

test('roadmap entries are read under the first "## Planned" only, comments aside (§4.7)', () => {
  const roadmap = [
    '# Roadmap', '', '## Tracks', '', '### D1 — Not here', '', '## Planned', '', '<!-- "### D<n> — <title>" -->', '<!-- ### D8 — commented -->',
    '### D3 — Three', '', 'Its scope.', '', '### D5: Five | more', '', '## Candidates', '', '## From the previous ledger', '', '## Planned', '', '### D9 — Old text',
  ].join('\n');
  assert.deepEqual(roadmapEntries(roadmap), [{ n: 3, title: 'Three' }, { n: 5, title: 'Five | more' }]);
});

test('an open plan gives its row, linked; a shipped plan gives none; a roadmap entry stands in for a plan not yet written', () => {
  const plans = [
    { n: 2, file: 'D2.md', title: 'From the plan', status: 'in progress' },
    { n: 4, file: 'D4.md', title: 'Shipped', status: 'shipped' },
    { n: 6, file: 'D6.md', title: 'Odd', status: 'someday' },
  ];
  const entries = [{ n: 2, title: 'From the roadmap' }, { n: 4, title: 'Shipped' }, { n: 6, title: 'Odd' }, { n: 1, title: 'One' }];
  assert.deepEqual(ledgerRows(plans, entries), [
    { n: 1, title: 'One', status: 'planned', link: null },
    { n: 2, title: 'From the plan', status: 'in progress', link: 'D2.md' },
    { n: 6, title: 'Odd', status: 'planned', link: null },
  ]);
  assert.deepEqual(ledgerRows([], entries, [1, 6]).map((r) => r.n), [2, 4], 'a number in SHIPPED.md takes no roadmap entry');
});

test('regenerating takes a merge’s conflict markers among the rows with it, and leaves the text around the table', () => {
  const conflicted = [
    '# Ledger', '', '| D | Title | Status |', '| --- | --- | --- |', '<<<<<<< HEAD', '| [D1](D1.md) | One | in progress |', '| D2 | Two | planned |',
    '=======', '| D1 | One | planned |', '| [D2](D2.md) | Two | in progress |', '>>>>>>> lane/D2', '', 'After.', '',
  ].join('\n');
  assert.ok(!sameRows(conflicted, []), 'a conflicted table is never current');
  const rows = [{ n: 1, title: 'One', status: 'in progress', link: 'D1.md' }, { n: 2, title: 'Two', status: 'in progress', link: 'D2.md' }];
  assert.equal(renderLedger(conflicted, rows), '# Ledger\n\n| D | Title | Status |\n| --- | --- | --- |\n| [D1](D1.md) | One | in progress |\n| [D2](D2.md) | Two | in progress |\n\nAfter.\n');
  const opensAfter = '| D | Title | Status |\n| --- | --- | --- |\n| D1 | One | planned |\n<<<<<<< HEAD\nprose\n=======\nother\n>>>>>>> x\n';
  assert.deepEqual(tableSpan(opensAfter.split('\n')), { start: 0, end: 3 }, 'a conflict that closes in the prose is not the table’s');
  assert.deepEqual(conflictsOutside(opensAfter), [4, 6, 8]);
  const reaching = '| D | Title | Status |\n| --- | --- | --- |\n<<<<<<< HEAD\n| D1 | One | planned |\n\nx\n=======\n| D1 | One | in progress |\n>>>>>>> b\n';
  assert.deepEqual(tableSpan(reaching.split('\n')), { start: 0, end: 2 }, 'nor one with a blank line and prose in it');
  assert.deepEqual(conflictsOutside(reaching), [3, 7, 9]);
  const diff3 = '| D | Title | Status |\n| --- | --- | --- |\n<<<<<<< HEAD\n| D1 | One | in progress |\n||||||| base\n| D1 | One | planned |\n=======\n| D1 | One | planned |\n>>>>>>> b\n';
  assert.deepEqual(tableSpan(diff3.split('\n')), { start: 0, end: 9 }, 'a diff3 conflict of rows alone is the table’s');
  assert.deepEqual(conflictsOutside(diff3), []);
  assert.equal(renderLedger('a\r\n\r\n| D | Title | Status |\r\n| --- | --- | --- |\r\n', rows.slice(0, 1)), 'a\r\n\r\n| D | Title | Status |\r\n| --- | --- | --- |\r\n| [D1](D1.md) | One | in progress |\r\n', 'CRLF stays CRLF');
});
