// `slipway docs-check`: the documents' shape and the byte budgets (docs/design.md §4.3, §4.7, §5.2, §7, §14).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { digest, parseRules, wordCount } from './digest.mjs';
import { isGlob, matches } from './glob.mjs';
import { LEDGER_HEADER, SHIPPED_HEADER, hasTable, readRows } from './ledger.mjs';
import { generatedLedger } from './lane.mjs';
import { CI_VALUES, RELEASE_PARTS, listPlans, parseDecisions, statusWord } from './plan.mjs';
import { BUDGET_FILE } from './init.mjs';
import { listRecords } from './records.mjs';

const CLOSE_OUT = /\b(close[- ]?out|wrap[- ]?up|finali[sz]e|tidy[- ]?up|clean[- ]?up)\b/i;
const posix = (p) => p.split(path.sep).join('/');

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

/** The files docs-check sees: tracked and untracked, never ignored ones (§14). */
export function listFiles(root) {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']) ?? '';
  return [...new Set(out.split('\0').filter(Boolean))].filter((f) => existsSync(path.join(root, f)));
}

/** Paths the current branch adds or changes against the default branch, untracked ones included. */
export function changedOnBranch(root, config) {
  const remote = `origin/${config.defaultBranch}`;
  const target = git(root, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}`]) ? remote : config.defaultBranch;
  const mb = git(root, ['merge-base', 'HEAD', target])?.trim();
  const diff = mb ? (git(root, ['diff', '--name-only', '-z', mb]) ?? '') : '';
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard']) ?? '';
  return new Set([...diff.split('\0'), ...untracked.split('\0')].filter(Boolean));
}

/** Run every check. Returns { problems: ["path:line: message"], files }. */
export function docsCheck(root, config, pluginRoot) {
  const problems = [];
  const bad = (file, line, msg) => problems.push(`${file}${line ? `:${line}` : ''}: ${msg}`);
  const files = listFiles(root);
  const read = (f) => readFileSync(path.join(root, f), 'utf8');
  const has = (f) => existsSync(path.join(root, f));
  const { plans: plansDir, records: recordsDir } = config.docs;
  const resolves = (from, link) => /^[a-z]+:/i.test(link) || link.startsWith('#') || existsSync(path.resolve(root, path.dirname(from), link.split('#')[0]));

  // The ledger, three files (§4.7).
  const ledger = posix(path.join(plansDir, 'README.md'));
  const ledgerRows = new Map();
  if (!has(ledger)) bad(ledger, 0, 'missing; run slipway init');
  else {
    const text = read(ledger);
    if (!/^Tags: /m.test(text)) bad(ledger, 0, 'needs its "Tags:" line');
    if (!hasTable(text)) bad(ledger, 0, `needs the "${LEDGER_HEADER}" table`);
    else {
      // The table is generated from the plans' headers and the roadmap's planned entries (§4.7).
      const gen = generatedLedger(root, config);
      for (const p of gen.problems) problems.push(p);
      if (!gen.problems.length && gen.text !== null) bad(ledger, 0, "the table differs from the plans' headers and the roadmap; run slipway ledger generate");
    }
    for (const r of readRows(text)) {
      if (ledgerRows.has(r.n)) bad(ledger, r.line + 1, `D${r.n} has two rows`);
      ledgerRows.set(r.n, r);
      if (!['planned', 'in progress'].includes(r.status)) bad(ledger, r.line + 1, `D${r.n}: status "${r.status}" is not planned or in progress; shipped rows live in SHIPPED.md`);
      if (r.link && !resolves(ledger, r.link)) bad(ledger, r.line + 1, `D${r.n}: link ${r.link} does not resolve`);
    }
  }
  const shippedFile = posix(path.join(plansDir, 'SHIPPED.md'));
  if (has(shippedFile)) {
    const text = read(shippedFile);
    if (!hasTable(text, SHIPPED_HEADER)) bad(shippedFile, 0, `needs the "${SHIPPED_HEADER}" table`);
    for (const r of readRows(text, SHIPPED_HEADER)) {
      if (ledgerRows.has(r.n)) bad(shippedFile, r.line + 1, `D${r.n} is also open in the ledger`);
      if (r.link && !resolves(shippedFile, r.link)) bad(shippedFile, r.line + 1, `D${r.n}: link ${r.link} does not resolve`);
    }
  }

  // Plans and their decisions files (§4.1, §4.3, §4.6).
  const plans = listPlans(path.join(root, plansDir));
  for (const { n, file, plan } of plans) {
    const f = posix(path.join(plansDir, file));
    const at = (key) => (plan.headerLines[key] ?? -1) + 1;
    const status = statusWord(plan.header.Status);
    if (plan.n !== n) bad(f, 1, `the title must be "# D${n}. <title>"`);
    for (const key of ['Status', 'Records', 'CI']) if (!(key in plan.header)) bad(f, 0, `needs a "- ${key}:" header line`);
    if (!['planned', 'in progress', 'shipped'].includes(status)) bad(f, at('Status'), `Status "${plan.header.Status}" is not planned, in progress or shipped`);
    if ('CI' in plan.header) {
      const ci = plan.header.CI.split(/\s/)[0];
      if (!CI_VALUES.includes(ci)) bad(f, at('CI'), `CI must be one of ${CI_VALUES.join(', ')}`);
      else if (config.forge === 'none' && ci !== 'off') bad(f, at('CI'), 'CI must be off when forge is none (§4.6)');
    }
    if ('Release' in plan.header) {
      if (!config.release) bad(f, at('Release'), 'a Release line needs a release block in slipway.config.json');
      else if (!RELEASE_PARTS.includes(plan.header.Release.split(/\s/)[0])) bad(f, at('Release'), `Release must be one of ${RELEASE_PARTS.join(', ')}`);
    }
    if (status === 'in progress' && !plan.header.Branch) bad(f, 0, 'an in-progress plan needs a "- Branch:" line');
    for (const rec of [...(plan.header.Records ?? '').matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])) {
      if (!resolves(f, rec)) bad(f, at('Records'), `record link ${rec} does not resolve`);
    }
    if (status !== 'shipped') {
      // A brownfield corpus's shipped plans are history, read as they are (§14).
      if (!plan.steps.length && status === 'in progress') bad(f, 0, 'an in-progress plan needs at least one step under "## Steps"');
      const dod = plan.dod.map((d) => d.text.toLowerCase());
      for (const s of plan.steps) {
        if (s.built === null) bad(f, s.start + 1, `step ${s.k} needs a "- [ ] Built" line`);
        if (!s.fields['Done when'] && status === 'in progress') bad(f, s.start + 1, `step ${s.k} needs a "- Done when:" line naming commands or tests`);
        if (CLOSE_OUT.test(s.title)) bad(f, s.start + 1, `step ${s.k} is a close-out; every step builds (§2)`);
        const dw = (s.fields['Done when'] ?? '').toLowerCase();
        if (dw && (dw.includes('definition of done') || dod.includes(dw))) bad(f, s.start + 1, `step ${s.k}'s done-when is the definition of done, which is the ship's`);
      }
    }
    const dfile = posix(path.join(plansDir, `D${n}.decisions.md`));
    if (has(dfile)) {
      for (const d of parseDecisions(read(dfile))) {
        if (d.malformed) bad(dfile, d.line, 'a line is "- Provisional (D<n>.<step>): …" or "- Owed (D<n>.<step>): …"');
        else if (status === 'shipped' && d.open) bad(dfile, d.line, `D${n} shipped with this line open; mark it Ratified, Overturned, Paid or Carried`);
      }
    }
  }

  // Records' rules (§5.2): shape everywhere, the 120-word cap only where this branch writes (§14).
  const changed = changedOnBranch(root, config);
  for (const r of listRecords(path.join(root, recordsDir))) {
    const f = posix(path.join(recordsDir, r.file));
    for (const rule of parseRules(r.text)) {
      if (rule.malformed) bad(f, rule.line, 'a rule is "- **Topic.** text (with: …) (areas: …)"');
      else if (changed.has(f) && wordCount(rule) > 120) bad(f, rule.line, `rule "${rule.topic}" is ${wordCount(rule)} words; the cap is 120`);
    }
  }

  // Digests, as the generator renders them after the formatter (§3.3, §5.2).
  const d = digest(root, config, readFileSync(path.join(pluginRoot, 'templates', 'digest.md'), 'utf8'), { check: true });
  for (const p of d.problems) problems.push(p);
  for (const s of d.stale) bad(s, 0, 'differs from what slipway digest writes; run it');

  // Behaviour specs (§14): every requirement has a scenario with WHEN and THEN, and a Proved by: that exists.
  if (config.docs.specs) {
    for (const f of files.filter((x) => x.startsWith(`${config.docs.specs}/`) && x.endsWith('.md'))) checkSpec(f, read(f), bad, has);
  }

  // Budgets (§7, §14).
  if (has(BUDGET_FILE)) checkBudget(root, files, read(BUDGET_FILE), bad);

  return { problems, files: files.length };
}

function checkSpec(f, text, bad, has) {
  const lines = text.split(/\r?\n/);
  const reqs = [];
  lines.forEach((l, i) => {
    if (/^## Requirement:/.test(l)) reqs.push({ line: i + 1, body: [] });
    else if (/^## /.test(l)) reqs.push(null);
    else if (reqs.at(-1)) reqs.at(-1).body.push({ l, i });
  });
  for (const req of reqs.filter(Boolean)) {
    const scenarios = [];
    for (const { l, i } of req.body) {
      if (/^### Scenario:/.test(l)) scenarios.push({ line: i + 1, text: '' });
      else if (scenarios.length) scenarios.at(-1).text += `${l}\n`;
    }
    if (!scenarios.length) bad(f, req.line, 'a requirement needs at least one "### Scenario:"');
    for (const s of scenarios) if (!/\bWHEN\b/.test(s.text) || !/\bTHEN\b/.test(s.text)) bad(f, s.line, 'a scenario needs a WHEN and a THEN line');
    const proved = req.body.filter(({ l }) => /^\s*[-*]?\s*Proved by:/.test(l));
    if (!proved.length) bad(f, req.line, 'a requirement needs a "Proved by:" line');
    for (const { l, i } of proved) {
      const paths = [...l.matchAll(/`([^`]+)`/g)].map((m) => m[1].split(/::| › /)[0].trim());
      if (!paths.length) bad(f, i + 1, '"Proved by:" names its tests as backticked paths');
      for (const p of paths) if (!has(p)) bad(f, i + 1, `Proved by: ${p} does not exist`);
    }
  }
}

function checkBudget(root, files, text, bad) {
  let budget;
  try {
    budget = JSON.parse(text);
  } catch (err) {
    bad(BUDGET_FILE, 0, `not valid JSON: ${err.message}`);
    return;
  }
  if (budget === null || typeof budget !== 'object' || Array.isArray(budget)) {
    bad(BUDGET_FILE, 0, 'must hold one object from a path or glob to a ceiling in bytes');
    return;
  }
  const entries = Object.entries(budget).filter(([k]) => k !== '$schema' && k !== '$comment');
  for (const [k, v] of entries) {
    if (!Number.isInteger(v) || v <= 0) bad(BUDGET_FILE, 0, `${k}: a ceiling is a positive whole number of bytes`);
    else if (!isGlob(k) && !files.includes(k)) bad(BUDGET_FILE, 0, `${k}: names no file; remove the entry`);
  }
  const valid = entries.filter(([, v]) => Number.isInteger(v) && v > 0);
  for (const f of files) {
    const exact = valid.find(([k]) => !isGlob(k) && k === f);
    const globs = valid.filter(([k]) => isGlob(k) && matches(k, f)).map(([, v]) => v);
    const ceiling = exact ? exact[1] : globs.length ? Math.min(...globs) : null;
    if (ceiling === null) continue;
    const size = statSync(path.join(root, f)).size;
    if (size > ceiling) bad(f, 0, `${size} bytes, over its ceiling of ${ceiling} in ${BUDGET_FILE}`);
  }
}
