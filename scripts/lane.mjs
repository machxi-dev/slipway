// Lanes from branches, the ledger's rows, and the overlap warning (docs/design.md §4.2, §4.7, §14).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { laneBranch, laneFromBranch, laneWorktree } from './config.mjs';
import { currentBranch, listFiles, mainRoot, remoteBranches, showFile } from './git.mjs';
import { matches } from './glob.mjs';
import { format } from './digest.mjs';
import { LEDGER_HEADER, SHIPPED_HEADER, conflictsOutside, ledgerRows, readRows, renderLedger, roadmapEntries, rowLine, sameRows, setRow, shippedLine } from './ledger.mjs';
import { decisionsName, linkedRecords, listPlans, parseDecisions, parsePlan, planName, setHeader, statusWord } from './plan.mjs';
import { today } from './records.mjs';

const usage = (message) => Object.assign(new Error(message), { code: 'EUSAGE' });
const posix = (p) => p.split(path.sep).join('/');

/** `D45` or `D45.3` → { n: 45, k: 3 | null }; anything else throws. */
export function parseLaneArg(arg) {
  const m = /^D(\d+)(?:\.(\d+))?$/i.exec(arg ?? '');
  if (!m) throw usage(`"${arg}" is not a deliverable; name one as D<n> or D<n>.<step>`);
  return { n: Number(m[1]), k: m[2] === undefined ? null : Number(m[2]) };
}

/**
 * The lane: from the argument, else from the current branch through lane.branch, else from the plan whose
 * `- Branch:` line names the current branch (§14: a branch the pattern does not match).
 */
export function findLane(root, config, arg) {
  const plansDir = path.join(root, config.docs.plans);
  const branch = currentBranch(root);
  let n;
  let k = null;
  if (arg) ({ n, k } = parseLaneArg(arg));
  else {
    n = laneFromBranch(config, branch)?.n;
    if (n === undefined) {
      const named = listPlans(plansDir).filter((p) => branchOf(p.plan) === branch && statusWord(p.plan.header.Status) === 'in progress');
      if (named.length === 1) n = named[0].n;
      else throw usage(`the branch "${branch ?? '(detached)'}" is not a lane; name the lane as D<n>`);
    }
  }
  const planFile = path.join(plansDir, planName(n));
  const plan = existsSync(planFile) ? parsePlan(readFileSync(planFile, 'utf8')) : null;
  const laneBranchName = (plan && branchOf(plan)) || laneBranch(config, n);
  const decisionsFile = path.join(plansDir, decisionsName(n));
  return {
    n,
    k,
    root,
    plan,
    planFile: posix(path.relative(root, planFile)),
    decisionsFile: posix(path.relative(root, decisionsFile)),
    decisions: existsSync(decisionsFile) ? parseDecisions(readFileSync(decisionsFile, 'utf8')) : [],
    branch: laneBranchName,
    current: branch,
    worktree: laneWorktree(config, mainRoot(root), n),
  };
}

export const branchOf = (plan) => (plan.header.Branch ?? '').replace(/`/g, '').trim() || null;

const literalPrefix = (glob) => glob.replaceAll('\\', '/').split(/[*?[]/)[0];

/** True when two path globs can name a common file: one's literal prefix starts the other's. */
export function overlaps(a, b) {
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  // A glob with no literal prefix (`**/*.sql`) is tested against the other with its wildcards filled in.
  const sample = (g) => g.replaceAll('\\', '/').replace(/\*\*\/?/g, '').replace(/[*?]/g, 'x');
  if (!pa || !pb) return matches(a, sample(b)) || matches(b, sample(a));
  return pa.startsWith(pb) || pb.startsWith(pa);
}

/** A step's `Paths:` value as globs. */
export const pathGlobs = (paths = '') =>
  paths
    .split(/[,;]/)
    .map((p) => p.replace(/`/g, '').trim())
    .filter(Boolean);

/** The conventions skills the config names for the areas a step's paths reach (§4.4). */
export function skillsFor(config, paths) {
  const globs = pathGlobs(paths);
  const skills = [];
  for (const area of Object.values(config.areas)) {
    if (area.paths.some((a) => globs.some((g) => overlaps(a, g)))) for (const s of area.skills) if (!skills.includes(s)) skills.push(s);
  }
  return skills;
}

/** The SKILL.md of a conventions skill the repository keeps, relative to root, or null (a plugin's or a user's skill). */
export function skillFile(root, name) {
  const file = `.claude/skills/${name}/SKILL.md`;
  return existsSync(path.join(root, file)) ? file : null;
}

/** A plan's `## Constraints` section, heading included and comments out, or [] when it has none or it is empty. */
export function constraintLines(plan) {
  const start = plan.lines.findIndex((l) => /^## Constraints\s*$/i.test(l));
  if (start < 0) return [];
  const end = plan.lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const body = plan.lines.slice(start + 1, end < 0 ? plan.lines.length : end).join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
  return body ? [plan.lines[start], '', ...body.split('\n')] : [];
}

/**
 * What `slipway lane --step <k>` prints for the builder (§4.4): the plan's header, its constraints and the step's
 * section, the lane branch, the decisions file, and each conventions skill with its SKILL.md path, which the builder
 * reads, or that the repository does not keep it, from the checkout the lane was found in. Returns
 * { text, step, skills: [{ name, file | null }] }, or null with no such step.
 */
export function stepBrief(config, lane, k) {
  const { plan } = lane;
  const step = plan.steps.find((s) => s.k === k);
  if (!step) return null;
  const head = plan.lines.slice(0, plan.lines.findIndex((l) => l.startsWith('## ')));
  const constraints = constraintLines(plan);
  const text = [...head, ...(constraints.length ? [...constraints, ''] : []), ...plan.lines.slice(step.start, step.end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  const skills = skillsFor(config, step.fields.Paths ?? '').map((name) => ({ name, file: skillFile(lane.root, name) }));
  const lines = [
    text,
    '',
    `Lane branch: ${lane.branch}${lane.current === lane.branch ? '' : ` (checked out: ${lane.current ?? 'detached'})`}`,
    `Decisions file: ${lane.decisionsFile}`,
    `Conventions skills:${skills.length ? '' : ' none'}`,
    ...skills.map((s) => `- ${s.name}: ${s.file ?? 'not found in .claude/skills'}`),
  ];
  return { text: lines.join('\n'), step, skills };
}

/**
 * The lane branches on origin, by the lane.branch pattern, fetched first: [{ ref, n }]. None when there is no origin
 * (§4.1: a planned or open row reaches the default branch only with its lane).
 */
export function remoteLanes(root, config) {
  const [before, after] = config.lane.branch.split('{n}');
  return remoteBranches(root, `${before}*${after}`)
    .map((b) => ({ ref: `refs/remotes/origin/${b}`, n: laneFromBranch(config, b)?.n }))
    .filter((l) => l.n !== undefined);
}

const plansPath = (config) => posix(path.normalize(config.docs.plans));

/** The plan a lane branch on origin holds for its own lane, as { n, plan }, or null. */
function remotePlan(root, config, lane) {
  const text = showFile(root, lane.ref, `${plansPath(config)}/${planName(lane.n)}`);
  return text === null ? null : { n: lane.n, file: planName(lane.n), plan: parsePlan(text), ref: lane.ref };
}

/**
 * §4.2: a new or open plan naming a record another open plan names, or two open plans adding migrations. The open
 * plans are the checked-out tree's and each remote lane branch's own; a plan found in both places counts once.
 */
export function overlapWarnings(root, config, n) {
  const plans = listPlans(path.join(root, config.docs.plans));
  const mine = plans.find((p) => p.n === n);
  if (!mine) throw usage(`no plan D${n}`);
  const isOpen = (p) => p.n !== n && statusWord(p.plan.header.Status) === 'in progress';
  const open = plans.filter(isOpen);
  for (const lane of remoteLanes(root, config)) {
    if (open.some((p) => p.n === lane.n)) continue;
    const p = remotePlan(root, config, lane);
    if (p && isOpen(p)) open.push(p);
  }
  open.sort((a, b) => a.n - b.n);
  const warnings = [];
  const myRecords = linkedRecords(mine.plan.header.Records);
  for (const o of open) {
    const shared = linkedRecords(o.plan.header.Records).filter((r) => myRecords.includes(r));
    if (shared.length) warnings.push(`D${n} and D${o.n} (in progress) both name ${shared.join(', ')}`);
    const migrates = (p) => /^yes\b/i.test(p.plan.header.Migrations ?? '');
    if (migrates(mine) && migrates(o)) warnings.push(`D${n} and D${o.n} (in progress) both add migrations`);
  }
  return warnings;
}

// ---- the ledger's rows -------------------------------------------------------------------------------------

const ledgerFiles = (root, config) => {
  const dir = path.join(root, config.docs.plans);
  return { dir, readme: path.join(dir, 'README.md'), shipped: path.join(dir, 'SHIPPED.md'), roadmap: path.join(dir, 'ROADMAP.md') };
};
const readIf = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');

const roadmapNumbers = (text) => [...text.matchAll(/\bD(\d+)\b/g)].map((m) => Number(m[1]));
const planNumbers = (files) => files.map((f) => /^D(\d+)\.md$/.exec(f)).filter(Boolean).map((m) => Number(m[1]));

/**
 * The number after every deliverable the ledger, the shipped rows, the roadmap and the plans name, in the
 * checked-out tree and on each lane branch on origin: a row planned or scoped there is not on the default branch yet.
 */
export function nextDeliverable(root, config) {
  const f = ledgerFiles(root, config);
  const nums = [
    ...readRows(readIf(f.readme)).map((r) => r.n),
    ...readRows(readIf(f.shipped), SHIPPED_HEADER).map((r) => r.n),
    ...roadmapNumbers(readIf(f.roadmap)),
    ...listPlans(f.dir).map((p) => p.n),
  ];
  const dir = plansPath(config);
  for (const lane of remoteLanes(root, config)) {
    nums.push(lane.n, ...planNumbers(listFiles(root, lane.ref, dir)), ...roadmapNumbers(showFile(root, lane.ref, `${dir}/ROADMAP.md`) ?? ''));
  }
  return Math.max(0, ...nums) + 1;
}

const rel = (root, p) => posix(path.relative(root, p));

/**
 * The ledger as its sources make it (§4.7): the plans' headers and the roadmap's planned entries. `edits` stands
 * in for files about to be written — `status` ({ [n]: status } for plans), `roadmap` and `shipped` texts.
 * Returns { text, rows, current, problems }; text is null when the table already holds the rows.
 */
export function generatedLedger(root, config, { status = {}, roadmap, shipped } = {}) {
  const f = ledgerFiles(root, config);
  const current = readFileSync(f.readme, 'utf8');
  const plans = planSources(f.dir).map((p) => ({ ...p, status: status[p.n] ?? p.status }));
  const shippedRows = readRows(shipped ?? readIf(f.shipped), SHIPPED_HEADER).map((r) => r.n);
  const rows = ledgerRows(plans, roadmapEntries(roadmap ?? readIf(f.roadmap)), shippedRows);
  const where = `${config.docs.plans}/README.md`;
  // A row with no source is refused, not dropped: it would be the only place its title is written.
  const kept = new Set([...rows.map((r) => r.n), ...shippedRows]);
  const problems = readRows(current)
    .filter((r) => !kept.has(r.n))
    .map((r) => {
      const plan = plans.find((p) => p.n === r.n);
      const why = plan ? `its plan's Status is "${plan.status}", not planned or in progress,` : 'has no plan';
      return `${where}:${r.line + 1}: D${r.n} ${why} and no "### D${r.n} — <title>" entry under "## Planned" in ROADMAP.md; add one, or remove the row`;
    });
  for (const line of conflictsOutside(current)) problems.push(`${where}:${line}: a merge conflict outside the table's rows; resolve it by hand, then run slipway ledger generate`);
  return { text: sameRows(current, rows) ? null : renderLedger(current, rows), rows, current, problems };
}

/** Write the generated ledger, through commands.format. Returns the paths written. */
function writeLedger(root, config, gen) {
  if (gen.problems.length) throw usage(gen.problems.join('\n'));
  if (gen.text === null) return [];
  const file = ledgerFiles(root, config).readme;
  writeFileSync(file, gen.text);
  try {
    format(root, config, [rel(root, file)]);
  } catch (err) {
    writeFileSync(file, gen.current);
    throw err;
  }
  return [rel(root, file)];
}

/** `slipway ledger generate [--check]`: write the table from the plans' headers, or say it is stale. */
export function generateLedger(root, config, { check = false } = {}) {
  const gen = generatedLedger(root, config);
  if (check || gen.problems.length) return { written: [], stale: gen.text !== null, problems: gen.problems };
  return { written: writeLedger(root, config, gen), stale: false, problems: [] };
}

/** The roadmap with an entry added after the `## Planned` heading's entries. */
export function addEntry(text, entry) {
  const crlf = /\r\n/.test(text ?? '');
  let roadmap = (text || '# Roadmap\n').replace(/\r\n/g, '\n');
  // The heading roadmapEntries reads, exactly: "## Planned work" is another section.
  const planned = /^##\s+Planned\s*$/m.exec(roadmap)?.index ?? -1;
  if (planned >= 0) {
    // Before the next "## " heading, or at the end.
    const next = roadmap.indexOf('\n## ', planned + 1);
    const at = next >= 0 ? next + 1 : roadmap.length;
    roadmap = `${roadmap.slice(0, at).trimEnd()}\n\n${entry}${next >= 0 ? `\n${roadmap.slice(at)}` : ''}`;
  } else roadmap = `${roadmap.trimEnd()}\n\n## Planned\n\n${entry}`;
  roadmap = roadmap.replace(/\n*$/, '\n');
  return crlf ? roadmap.replace(/\n/g, '\r\n') : roadmap;
}

/** The roadmap without D<n>'s entry: the one under `## Planned` when it has one, else the first anywhere. */
export function removeEntry(text, n) {
  const entry = new RegExp(`^### D${n}\\b[^\\n]*\\n[\\s\\S]*?(?=^##|(?![\\s\\S]))`, 'm');
  const start = /^##\s+Planned\s*$/m.exec(text);
  if (start) {
    const next = text.slice(start.index + start[0].length).search(/^## /m);
    const end = next < 0 ? text.length : start.index + start[0].length + next;
    const section = text.slice(start.index, end);
    if (entry.test(section)) return text.slice(0, start.index) + section.replace(entry, '') + text.slice(end);
  }
  return entry.test(text) ? text.replace(entry, '') : null;
}

/** The plans as the ledger reads them: [{ n, file, title, status }]. */
export const planSources = (dir) => listPlans(dir).map(({ n, file, plan }) => ({ n, file, title: plan.title, status: statusWord(plan.header.Status), statusText: plan.header.Status ?? '' }));

/** Add a planned row: its roadmap entry, and the table regenerated. Returns n. */
export function addRow(root, config, title, scope) {
  const f = ledgerFiles(root, config);
  const n = nextDeliverable(root, config);
  const roadmap = addEntry(readIf(f.roadmap), `### D${n} — ${title}\n\n${scope ? `${scope}\n` : ''}`);
  const gen = generatedLedger(root, config, { roadmap });
  if (gen.problems.length) throw usage(gen.problems.join('\n'));
  if (!gen.rows.some((r) => r.n === n)) throw new Error(`D${n}'s roadmap entry would not make a row; ROADMAP.md needs a "## Planned" heading`);
  // The table first: it alone goes through the formatter, and it is put back when that fails.
  writeLedger(root, config, gen);
  writeFileSync(f.roadmap, roadmap);
  return n;
}

/** A row as its sources make it, or a usage error naming where it would come from. */
function sourceRow(root, config, n) {
  const row = generatedLedger(root, config).rows.find((r) => r.n === n);
  if (!row) throw usage(`no row D${n}: no open plan ${config.docs.plans}/${planName(n)} and no "### D${n} — <title>" entry under "## Planned" in ROADMAP.md`);
  return row;
}

/** Set a plan header's Status, and regenerate the table. Returns the paths written. */
export function setStatus(root, config, n, status) {
  if (!['planned', 'in progress'].includes(status)) throw usage('a ledger row is "planned" or "in progress"; /slipway:ship moves it to SHIPPED.md');
  const f = ledgerFiles(root, config);
  sourceRow(root, config, n);
  const planFile = path.join(f.dir, planName(n));
  if (!existsSync(planFile) && status !== 'planned') throw usage(`D${n} has no plan yet; /slipway:scope writes ${config.docs.plans}/${planName(n)} first`);
  // Every new text is made before any file is written, so a failure leaves both as they were.
  const old = existsSync(planFile) ? readFileSync(planFile, 'utf8') : null;
  const plan = old !== null ? setHeader(old, 'Status', status) : null;
  const gen = generatedLedger(root, config, { status: { [n]: status } });
  if (gen.problems.length) throw usage(gen.problems.join('\n'));
  const written = writeLedger(root, config, gen);
  if (plan !== null && plan !== old) {
    writeFileSync(planFile, plan);
    written.push(rel(root, planFile));
  }
  return written;
}

/** Move a row to SHIPPED.md with its date and pull request, mark the plan shipped, regenerate (§4.5 step 4). */
export function shipRow(root, config, n, { pr = '', date = today() } = {}) {
  const f = ledgerFiles(root, config);
  const row = sourceRow(root, config, n);
  if (!existsSync(f.shipped)) throw usage(`${config.docs.plans}/SHIPPED.md is missing; run slipway init`);
  // Every new text is made before any file is written, so a failure never loses the row.
  const shipped = setRow(readFileSync(f.shipped, 'utf8'), { n, title: row.title, date, pr, link: row.link }, SHIPPED_HEADER, shippedLine);
  const planFile = path.join(f.dir, planName(n));
  const plan = existsSync(planFile) ? setHeader(readFileSync(planFile, 'utf8'), 'Status', `shipped ${date}`) : null;
  // The row's roadmap entry is done with: SHIPPED.md and the plan carry it from here (§4.7).
  const oldRoadmap = readIf(f.roadmap);
  const roadmap = removeEntry(oldRoadmap, n);
  const gen = generatedLedger(root, config, { status: { [n]: 'shipped' }, roadmap: roadmap ?? oldRoadmap, shipped });
  if (gen.problems.length) throw usage(gen.problems.join('\n'));
  // The table first: it alone goes through the formatter, and it is put back when that fails.
  const ledger = writeLedger(root, config, gen);
  writeFileSync(f.shipped, shipped);
  const written = [rel(root, f.shipped), ...ledger];
  if (plan !== null) writeFileSync(planFile, plan);
  if (roadmap !== null) writeFileSync(f.roadmap, roadmap);
  return [...written, ...(plan !== null ? [rel(root, planFile)] : []), ...(roadmap !== null ? [rel(root, f.roadmap)] : [])];
}

export { LEDGER_HEADER, rowLine };
