// Records: numbering, the status line, supersession and the records index (docs/design.md §2, §5, §14).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const usage = (message) => Object.assign(new Error(message), { code: 'EUSAGE' });

/** Today as YYYY-MM-DD in local time. */
export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const slugify = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '') || 'record';

const STATUS_LINE = /^[-*]?\s*Status:[ \t]*(.*)$/im;
/** `0007-x.md`, `ADR-0007-x.md`, `adr_7.md`: an optional prefix, then the number. */
const NUMBERED = /^((?:adr[-_]?)?)(\d+)[-_.]/i;

/** The status word of a record's text: proposed, accepted, superseded, or what the line says, lower-cased. */
export function statusOf(text) {
  const line = STATUS_LINE.exec(text)?.[1]?.trim();
  if (!line) return 'unknown';
  return /^superseded\b/i.test(line) ? 'superseded' : line.split(/[\s;,(]/)[0].toLowerCase();
}

export const titleOf = (text, fallback) => /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? fallback;

/** Every record in dir, by file name order: { file, number, title, status, text }. */
export function listRecords(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort()
    .map((file) => {
      const text = readFileSync(path.join(dir, file), 'utf8');
      const digits = NUMBERED.exec(file)?.[2] ?? null;
      return { file, number: digits, title: titleOf(text, file), status: statusOf(text), text };
    });
}

/** The number after the highest, zero-padded to the corpus's width (four by default). */
export function nextNumber(records) {
  const numbered = records.filter((r) => r.number !== null);
  const width = Math.max(4, ...numbered.map((r) => r.number.length));
  const next = numbered.reduce((m, r) => Math.max(m, Number(r.number)), 0) + 1;
  return String(next).padStart(width, '0');
}

/** The record an id names: `7`, `0007` or `ADR-0007`. Throws when none or two do. */
export function findRecord(records, id) {
  const n = /^(?:adr-?)?(\d+)$/i.exec(String(id).trim())?.[1];
  if (n === undefined) throw usage(`"${id}" is not a record number`);
  const found = records.filter((r) => r.number !== null && Number(r.number) === Number(n));
  if (found.length === 0) throw usage(`no record numbered ${n}`);
  if (found.length > 1) throw usage(`two records are numbered ${n}: ${found.map((r) => r.file).join(', ')}`);
  return found[0];
}

const link = (r) => `[${r.number ?? r.file.replace(/\.md$/, '')}](${r.file})`;
const cell = (s) => s.replace(/\|/g, '\\|');

/** One row of the records index. */
export const indexRow = (r) => `| ${link(r)} | ${cell(r.title.replace(/^\d+\.\s*/, ''))} | ${r.status} |\n`;

export const INDEX_HEADER = '| Record | Title | Status |';

/** Set the status cell of the index row linking to `file`, or add a row for it, inside the index's table. */
export function upsertIndexRow(indexFile, record) {
  const lines = readFileSync(indexFile, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === INDEX_HEADER);
  if (start < 0) throw new Error(`${indexFile} has no "${INDEX_HEADER}" table`);
  let end = start + 2;
  while (end < lines.length && lines[end].trim().startsWith('|')) end++;
  const target = `](${record.file})`;
  const row = indexRow(record).trimEnd();
  const i = lines.slice(start + 2, end).findIndex((l) => l.includes(target));
  if (i >= 0) lines[start + 2 + i] = row;
  else lines.splice(end, 0, row);
  writeFileSync(indexFile, lines.join('\n').replace(/\n*$/, '\n'));
}

/** Replace a record's status line, keeping its bullet style. */
export function withStatus(text, status) {
  if (!STATUS_LINE.test(text)) throw new Error('the record has no Status line');
  return text.replace(STATUS_LINE, (line) => line.replace(/(Status:[ \t]*).*$/i, `$1${status}`));
}

/** The records a `- Supersedes:` line links, as file names. */
export function supersededFiles(text) {
  const line = /^[-*]?\s*Supersedes:[ \t]*(.*)$/im.exec(text)?.[1] ?? '';
  return [...line.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => path.basename(m[1]));
}

/**
 * Write a new record from the template: the next number, `proposed` unless told otherwise, the parents it
 * supersedes linked. Returns the record. `template` is the record template's text.
 */
export function newRecord(dir, template, { title, supersedes = [], status = 'proposed', date = today() }) {
  if (!title || !title.trim()) throw usage('a record needs a title');
  const records = listRecords(dir);
  const parents = supersedes.map((id) => findRecord(records, id));
  const indexFile = path.join(dir, 'README.md');
  if (!existsSync(indexFile) || !readFileSync(indexFile, 'utf8').split(/\r?\n/).some((l) => l.trim() === INDEX_HEADER)) {
    throw usage(`${indexFile} has no "${INDEX_HEADER}" table; run slipway init (with --brownfield to adopt existing records)`);
  }
  const number = nextNumber(records);
  // A corpus named `ADR-0007-….md` keeps its prefix.
  const last = records.filter((r) => r.number !== null).at(-1);
  const prefix = last ? NUMBERED.exec(last.file)[1] : '';
  const file = `${prefix}${number}-${slugify(title)}.md`;
  let text = template
    .replaceAll('{{id}}', () => number)
    .replaceAll('{{title}}', () => title.trim())
    .replaceAll('{{date}}', () => date);
  text = withStatus(text, status);
  if (parents.length) text = text.replace(/^([-*]?\s*Supersedes:[ \t]*).*$/im, `$1${parents.map(link).join(', ')}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), text);
  const record = { file, number, title: `${number}. ${title.trim()}`, status: statusOf(text), text };
  upsertIndexRow(indexFile, record);
  return record;
}

/**
 * Accept a proposed record: its status reads `accepted`, and each parent its Supersedes line links reads
 * `superseded by` it. Returns the files changed, relative to dir.
 */
export function acceptRecord(dir, id) {
  const records = listRecords(dir);
  const record = findRecord(records, id);
  if (record.status !== 'proposed') throw usage(`${record.file} is ${record.status}, not proposed`);
  const changed = [];
  const write = (r, status) => {
    const text = withStatus(r.text, status);
    writeFileSync(path.join(dir, r.file), text);
    upsertIndexRow(path.join(dir, 'README.md'), { ...r, status: statusOf(text) });
    changed.push(r.file);
  };
  const parents = supersededFiles(record.text).map((f) => {
    const parent = records.find((r) => r.file === f);
    if (!parent) throw usage(`${record.file} supersedes ${f}, which is not in the records folder`);
    if (parent.status === 'superseded') throw usage(`${f} is already superseded`);
    if (!STATUS_LINE.test(parent.text)) throw usage(`${f} has no Status line to mark superseded; add one first`);
    return parent;
  });
  write(record, 'accepted');
  for (const p of parents) write(p, `superseded by ${link(record)}`);
  changed.push('README.md');
  return changed;
}
