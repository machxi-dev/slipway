import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findRecord, listRecords, nextNumber, slugify, statusOf, supersededFiles, withStatus } from './records.mjs';
import { slipway, tempRepo } from './testing.mjs';

const read = (repo, p) => readFileSync(path.join(repo, p), 'utf8');
const ready = (t) => {
  const repo = tempRepo(t);
  assert.equal(slipway(repo, ['init', '--check', 'x']).code, 0);
  return repo;
};

test('status lines are read in the plugin’s shape and the common other ones', () => {
  assert.equal(statusOf('- Status: accepted\n'), 'accepted');
  assert.equal(statusOf('* Status: Accepted\n'), 'accepted');
  assert.equal(statusOf('- Status: superseded by [0009](0009-x.md)\n'), 'superseded');
  assert.equal(statusOf('Status: proposed (2026-11-01)\n'), 'proposed');
  assert.equal(statusOf('# no status\n'), 'unknown');
  assert.equal(withStatus('# X\n\n* Status: proposed\n', 'accepted'), '# X\n\n* Status: accepted\n');
  assert.throws(() => withStatus('# X\n', 'accepted'), /no Status line/);
});

test('numbers follow the highest, at the corpus’s width; ids are read loosely but must name one record', () => {
  const recs = [{ number: '0007' }, { number: '0012' }, { number: null }];
  assert.equal(nextNumber(recs), '0013');
  assert.equal(nextNumber([]), '0001');
  assert.equal(nextNumber([{ number: '00041' }]), '00042');
  const corpus = [{ number: '0007', file: '0007-a.md' }];
  for (const id of ['7', '0007', 'ADR-0007', 'adr0007']) assert.equal(findRecord(corpus, id).file, '0007-a.md');
  assert.throws(() => findRecord(corpus, '8'), /no record numbered 8/);
  assert.throws(() => findRecord(corpus, 'seven'), /not a record number/);
  assert.throws(() => findRecord([...corpus, { number: '7', file: '7-b.md' }], '7'), /two records are numbered 7/);
  assert.equal(slugify('Use Postgres — not MySQL!'), 'use-postgres-not-mysql');
  assert.equal(supersededFiles('- Supersedes: [0003](0003-a.md), [0005](./0005-b.md)\n').join(), '0003-a.md,0005-b.md');
});

test('`slipway adr new` writes the next record, proposed, and lists it in the index', (t) => {
  const repo = ready(t);
  const r = slipway(repo, ['adr', 'new', 'Use', 'a', 'queue']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'docs/adr/0002-use-a-queue.md');
  const rec = read(repo, 'docs/adr/0002-use-a-queue.md');
  assert.match(rec, /^# 0002\. Use a queue\n\n- Status: proposed\n- Date: \d{4}-\d{2}-\d{2}\n- Supersedes: none\n/);
  assert.match(read(repo, 'docs/adr/README.md'), /\| \[0002\]\(0002-use-a-queue\.md\) \| Use a queue \| proposed \|\n$/);
  assert.equal(slipway(repo, ['adr', 'new']).code, 2);
  assert.match(slipway(repo, ['adr', 'new', 'X', '--supersedes', '9']).stderr, /no record numbered 9/);
});

test('`slipway adr accept` flips the record and supersedes its parents, in the files and the index', (t) => {
  const repo = ready(t);
  slipway(repo, ['adr', 'new', 'Queue']);
  slipway(repo, ['adr', 'accept', '2']);
  const r = slipway(repo, ['adr', 'new', 'Queue, durable', '--supersedes', '2']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(read(repo, 'docs/adr/0003-queue-durable.md'), /^- Supersedes: \[0002\]\(0002-queue\.md\)$/m);
  const a = slipway(repo, ['adr', 'accept', 'ADR-0003']);
  assert.equal(a.code, 0, a.stderr);
  assert.deepEqual(a.stdout.trim().split('\n'), ['docs/adr/0003-queue-durable.md', 'docs/adr/0002-queue.md', 'docs/adr/README.md']);
  assert.match(read(repo, 'docs/adr/0002-queue.md'), /^- Status: superseded by \[0003\]\(0003-queue-durable\.md\)$/m);
  const index = read(repo, 'docs/adr/README.md');
  assert.match(index, /\| \[0002\]\(0002-queue\.md\) \| Queue \| superseded \|/);
  assert.match(index, /\| \[0003\]\(0003-queue-durable\.md\) \| Queue, durable \| accepted \|/);
  assert.match(slipway(repo, ['adr', 'accept', '3']).stderr, /is accepted, not proposed/);
  assert.equal(listRecords(path.join(repo, 'docs/adr')).length, 3);
});

test('accepting a record whose parent is missing or already superseded is refused, and changes nothing', (t) => {
  const repo = ready(t);
  mkdirSync(path.join(repo, 'docs/adr'), { recursive: true });
  writeFileSync(path.join(repo, 'docs/adr/0002-x.md'), '# 0002. X\n\n- Status: proposed\n- Supersedes: [0009](0009-gone.md)\n');
  const r = slipway(repo, ['adr', 'accept', '2']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /supersedes 0009-gone\.md, which is not in the records folder/);
  assert.match(read(repo, 'docs/adr/0002-x.md'), /- Status: proposed/);
});
