import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_HEADER, cells, normalizeStatus, readRows, removeRow, rowLine, setRow, splitLegacy } from './ledger.mjs';

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
