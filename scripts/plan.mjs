// Plans and decisions files: reading their shape (docs/design.md §4.1, §4.3, §4.6, §14).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const CI_VALUES = ['on', 'at-ship', 'off'];
export const RELEASE_PARTS = ['patch', 'minor', 'major'];

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const HEADER = /^- ([A-Z][A-Za-z ]*):[ \t]*(.*)$/;
const FIELD = /^- (Done when|Records|Paths|Parts):[ \t]*(.*)$/;

export const planName = (n) => `D${n}.md`;
export const decisionsName = (n) => `D${n}.decisions.md`;

/** A plan's status word: planned, in progress, shipped, or the line's text when it is none of those. */
export function statusWord(value = '') {
  const v = value.trim().toLowerCase();
  if (v.startsWith('in progress')) return 'in progress';
  if (v.startsWith('shipped')) return 'shipped';
  if (v.startsWith('planned')) return 'planned';
  return v;
}

/** The record files a `Records:` value links, by base name. */
export const linkedRecords = (value = '') => [...value.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => path.posix.basename(m[1].replaceAll('\\', '/')));

/**
 * Parse a plan. Returns { n, title, header, headerLines, goal, dod, steps, lines }, where each step is
 * { k, title, built, fields, start, end } with start and end as 0-based line indexes (end exclusive).
 */
export function parsePlan(text) {
  const lines = text.split(/\r?\n/);
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  const m = /^# D(\d+)\.\s*(.*)$/.exec(lines[h1] ?? '');
  const plan = { n: m ? Number(m[1]) : null, title: m ? m[2].trim() : (lines[h1] ?? '').slice(2).trim(), header: {}, headerLines: {}, dod: [], steps: [], lines };
  let i = h1 + 1;
  for (; i < lines.length && !lines[i].startsWith('## '); i++) {
    const hm = HEADER.exec(lines[i]);
    if (hm && !(hm[1] in plan.header)) {
      plan.header[hm[1]] = hm[2].trim();
      plan.headerLines[hm[1]] = i;
    }
  }
  let section = null;
  let step = null;
  const closeStep = (end) => {
    if (step) {
      step.end = end;
      plan.steps.push(step);
      step = null;
    }
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      closeStep(i);
      section = line.slice(3).trim().toLowerCase();
      continue;
    }
    if (section === 'done when') {
      const c = /^- \[( |x|X)\] (.+)$/.exec(line);
      if (c) plan.dod.push({ done: c[1] !== ' ', text: c[2].trim(), line: i });
    } else if (section === 'steps') {
      const s = /^### (\d+)\.\s*(.*)$/.exec(line);
      if (s) {
        closeStep(i);
        step = { k: Number(s[1]), title: s[2].trim(), built: null, builtLine: null, fields: {}, start: i };
        continue;
      }
      if (!step) continue;
      const box = /^- \[( |x|X)\] Built\b/.exec(line);
      if (box) {
        step.built = box[1] !== ' ';
        step.builtLine = i;
      }
      const f = FIELD.exec(line);
      if (f) step.fields[f[1]] = stripComments(f[2]).trim();
    }
  }
  closeStep(lines.length);
  return plan;
}

/** The plan's header and one step's section, as the builder reads them (§4.4). */
export function stepText(plan, k) {
  const step = plan.steps.find((s) => s.k === k);
  if (!step) return null;
  const head = plan.lines.slice(0, plan.lines.findIndex((l) => l.startsWith('## ')));
  return [...head, ...plan.lines.slice(step.start, step.end)].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Tick a step's Built box. Returns the new text. */
export function tickStep(text, k) {
  const plan = parsePlan(text);
  const step = plan.steps.find((s) => s.k === k);
  if (!step || step.builtLine === null) throw new Error(`step ${k} has no "- [ ] Built" line`);
  plan.lines[step.builtLine] = plan.lines[step.builtLine].replace(/^- \[ \]/, '- [x]');
  return plan.lines.join('\n');
}

/** Set a header line's value. Returns the new text. */
export function setHeader(text, key, value) {
  const plan = parsePlan(text);
  if (!(key in plan.headerLines)) throw new Error(`the plan has no "- ${key}:" line`);
  plan.lines[plan.headerLines[key]] = `- ${key}: ${value}`;
  return plan.lines.join('\n');
}

const ITEM = /^- (Provisional|Owed) \(D(\d+)\.(\d+)\):\s*\S/;
const CLOSED = /\b(Ratified \d{4}-\d{2}-\d{2}|Overturned \d{4}-\d{2}-\d{2},\s*\S|Paid D\d+\.\d+)/;

/**
 * The lines of a decisions file (§4.3): { line, kind, step, open } for each list item outside comments, and
 * { line, malformed } for a list item in no known shape.
 */
export function parseDecisions(text) {
  const out = [];
  const masked = text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  masked.split(/\r?\n/).forEach((l, i) => {
    if (!/^\s*[-*] /.test(l)) return;
    const m = ITEM.exec(l);
    if (!m) out.push({ line: i + 1, malformed: true, text: l.trim() });
    else out.push({ line: i + 1, kind: m[1], step: `D${m[2]}.${m[3]}`, open: !CLOSED.test(l), text: l.trim() });
  });
  return out;
}

/** Every plan in the plans folder: [{ n, file, plan }], by number. */
export function listPlans(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((file) => ({ file, m: /^D(\d+)\.md$/.exec(file) }))
    .filter((x) => x.m)
    .map(({ file, m }) => ({ n: Number(m[1]), file, plan: parsePlan(readFileSync(path.join(dir, file), 'utf8')) }))
    .sort((a, b) => a.n - b.n);
}
