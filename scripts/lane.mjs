// Lanes from branches, the ledger's rows, and the overlap warning (docs/design.md §4.2, §4.7, §14).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { laneBranch, laneFromBranch, laneWorktree } from './config.mjs';
import { currentBranch, mainRoot } from './git.mjs';
import { matches } from './glob.mjs';
import { LEDGER_HEADER, SHIPPED_HEADER, readRows, removeRow, rowLine, setRow, shippedLine } from './ledger.mjs';
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

/** The conventions skills the config names for the areas a step's paths reach (§4.4). */
export function skillsFor(config, paths) {
  const globs = paths
    .split(/[,;]/)
    .map((p) => p.replace(/`/g, '').trim())
    .filter(Boolean);
  const skills = [];
  for (const area of Object.values(config.areas)) {
    if (area.paths.some((a) => globs.some((g) => overlaps(a, g)))) for (const s of area.skills) if (!skills.includes(s)) skills.push(s);
  }
  return skills;
}

/** §4.2: a new or open plan naming a record another open plan names, or two open plans adding migrations. */
export function overlapWarnings(root, config, n) {
  const plans = listPlans(path.join(root, config.docs.plans));
  const mine = plans.find((p) => p.n === n);
  if (!mine) throw usage(`no plan D${n}`);
  const open = plans.filter((p) => p.n !== n && statusWord(p.plan.header.Status) === 'in progress');
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

/** The number after every deliverable the ledger, the shipped rows, the roadmap and the plans name. */
export function nextDeliverable(root, config) {
  const f = ledgerFiles(root, config);
  const nums = [
    ...readRows(readIf(f.readme)).map((r) => r.n),
    ...readRows(readIf(f.shipped), SHIPPED_HEADER).map((r) => r.n),
    ...[...readIf(f.roadmap).matchAll(/\bD(\d+)\b/g)].map((m) => Number(m[1])),
    ...listPlans(f.dir).map((p) => p.n),
  ];
  return Math.max(0, ...nums) + 1;
}

/** Add a planned row and its roadmap entry. Returns n. */
export function addRow(root, config, title, scope) {
  const f = ledgerFiles(root, config);
  const n = nextDeliverable(root, config);
  writeFileSync(f.readme, setRow(readFileSync(f.readme, 'utf8'), { n, title, status: 'planned', link: null }));
  const entry = `### D${n} — ${title}\n\n${scope ? `${scope}\n` : ''}`;
  let roadmap = readIf(f.roadmap) || '# Roadmap\n';
  const planned = roadmap.indexOf('\n## Planned');
  if (planned >= 0) {
    // After the Planned heading's entries: before the next "## " heading, or at the end.
    const next = roadmap.indexOf('\n## ', planned + 1);
    const at = next >= 0 ? next + 1 : roadmap.length;
    roadmap = `${roadmap.slice(0, at).trimEnd()}\n\n${entry}${next >= 0 ? `\n${roadmap.slice(at)}` : ''}`;
  } else roadmap = `${roadmap.trimEnd()}\n\n## Planned\n\n${entry}`;
  writeFileSync(f.roadmap, roadmap.replace(/\n*$/, '\n'));
  return n;
}

/** Set a row's status, linking its plan when the plan exists, and the plan header's Status to match. */
export function setStatus(root, config, n, status) {
  if (!['planned', 'in progress'].includes(status)) throw usage('a ledger row is "planned" or "in progress"; /slipway:ship moves it to SHIPPED.md');
  const f = ledgerFiles(root, config);
  const text = readFileSync(f.readme, 'utf8');
  const row = readRows(text).find((r) => r.n === n);
  if (!row) throw usage(`no row D${n} in ${config.docs.plans}/README.md`);
  const planFile = path.join(f.dir, planName(n));
  const link = existsSync(planFile) ? planName(n) : row.link;
  // Every new text is made before any file is written, so a failure leaves both as they were.
  const ledger = setRow(text, { n, title: row.title, status, link });
  const plan = existsSync(planFile) ? setHeader(readFileSync(planFile, 'utf8'), 'Status', status) : null;
  writeFileSync(f.readme, ledger);
  if (plan !== null) writeFileSync(planFile, plan);
  return [f.readme, ...(plan !== null ? [planFile] : [])].map((p) => path.relative(root, p).split(path.sep).join('/'));
}

/** Move a row to SHIPPED.md with its date and pull request, and mark the plan shipped (§4.5 step 4). */
export function shipRow(root, config, n, { pr = '', date = today() } = {}) {
  const f = ledgerFiles(root, config);
  const text = readFileSync(f.readme, 'utf8');
  const row = readRows(text).find((r) => r.n === n);
  if (!row) throw usage(`no row D${n} in ${config.docs.plans}/README.md`);
  if (!existsSync(f.shipped)) throw usage(`${config.docs.plans}/SHIPPED.md is missing; run slipway init`);
  // Every new text is made before any file is written, so a failure never loses the row.
  const shipped = setRow(readFileSync(f.shipped, 'utf8'), { n, title: row.title, date, pr, link: row.link }, SHIPPED_HEADER, shippedLine);
  const planFile = path.join(f.dir, planName(n));
  const plan = existsSync(planFile) ? setHeader(readFileSync(planFile, 'utf8'), 'Status', `shipped ${date}`) : null;
  // The row's roadmap entry is done with: SHIPPED.md and the plan carry it from here (§4.7).
  const oldRoadmap = readIf(f.roadmap);
  const entry = new RegExp(`^### D${n}\\b[^\\n]*\\n[\\s\\S]*?(?=^##|(?![\\s\\S]))`, 'm');
  const roadmap = entry.test(oldRoadmap) ? oldRoadmap.replace(entry, '') : null;
  writeFileSync(f.shipped, shipped);
  writeFileSync(f.readme, removeRow(text, n));
  if (plan !== null) writeFileSync(planFile, plan);
  if (roadmap !== null) writeFileSync(f.roadmap, roadmap);
  return [f.shipped, f.readme, ...(plan !== null ? [planFile] : []), ...(roadmap !== null ? [f.roadmap] : [])].map((p) => path.relative(root, p).split(path.sep).join('/'));
}

export { LEDGER_HEADER, rowLine };
