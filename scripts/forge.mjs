// `slipway forge <verb>`: the forge adapter, `github` through `gh` and `none` locally (docs/design.md §3.3, §4.5, §4.6).
// The verbs: pr-open, pr, comment, comments, ready, merge (the pull request), and run (the last CI run on a commit).
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { currentBranch } from './git.mjs';
import { parsePlan } from './plan.mjs';

const usage = (message) => Object.assign(new Error(message), { code: 'EUSAGE' });
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** `gh`, or a Node script standing in for it (SLIPWAY_GH, for tests). */
function gh(root, args) {
  const fake = process.env.SLIPWAY_GH;
  const r = fake ? spawnSync(process.execPath, [fake, ...args], { cwd: root, encoding: 'utf8' }) : spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') throw new Error('gh is not installed; forge "github" needs the GitHub CLI, signed in (gh auth login)');
  if (r.status !== 0) throw new Error(`gh ${args[0]} ${args[1] ?? ''}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** forge none keeps a branch's step comments in the repository's common git dir, one JSON string per line. */
export const localComments = (root, branch) => {
  const common = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']).stdout.trim());
  return path.join(common, 'slipway', 'comments', `${branch.replace(/[^\w.-]+/g, '-')}.jsonl`);
};

/** The comments recorded for a branch; a line cut short by a crash is skipped. */
function readLocalComments(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((l) => {
      try {
        return l ? [JSON.parse(l)] : [];
      } catch {
        return [];
      }
    });
}

const hasOrigin = (root) => git(root, ['remote', 'get-url', 'origin']).status === 0;

/** The commit origin has for a branch, or null. */
function remoteHead(root, branch) {
  const r = git(root, ['ls-remote', '--heads', 'origin', branch]);
  return r.status === 0 ? (r.stdout.split(/\s/)[0] || null) : null;
}

/** The worktree that has `branch` checked out, or null. */
function worktreeOn(root, branch) {
  const out = git(root, ['worktree', 'list', '--porcelain']).stdout ?? '';
  let dir = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) dir = line.slice(9);
    else if (line === `branch refs/heads/${branch}`) return dir;
  }
  return null;
}

/**
 * A lane's pull request from its plan: the title `D<n> — <title>`, and a body of the plan's goal (the prose
 * between its header lines and its first section), its step titles and its CI line, with the plan's path.
 */
export function prFromPlan(root, planFile) {
  const plan = parsePlan(readFileSync(planFile, 'utf8'));
  const end = plan.lines.findIndex((l) => l.startsWith('## '));
  const headerLines = new Set(Object.values(plan.headerLines));
  const h1 = plan.lines.findIndex((l) => l.startsWith('# '));
  const goal = plan.lines
    .slice(h1 + 1, end < 0 ? plan.lines.length : end)
    .filter((l, i) => !headerLines.has(h1 + 1 + i))
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const rel = path.relative(root, path.resolve(planFile)).replaceAll('\\', '/');
  const body = [
    goal,
    '## Steps',
    plan.steps.map((s) => `${s.k}. ${s.title}`).join('\n'),
    `Plan: \`${rel}\` · CI: \`${plan.header.CI ?? '?'}\``,
  ].filter(Boolean);
  const name = plan.n === null ? plan.title : `D${plan.n} — ${plan.title}`;
  return { title: name, body: `${body.join('\n\n')}\n` };
}

/**
 * Classify the runs on one commit: green, red, running, cancelled or none. Each workflow's newest run counts
 * (a re-run supersedes the one before it); the commit is red when any workflow's is.
 */
export function runState(runs, sha) {
  const latest = new Map();
  for (const r of runs.filter((x) => x.headSha === sha)) {
    const key = r.workflowName ?? r.name ?? '';
    if (!latest.has(key)) latest.set(key, r);
  }
  const mine = [...latest.values()];
  if (!mine.length) return { state: 'none' };
  const running = mine.find((r) => r.status !== 'completed');
  if (running) return { state: 'running', run: running };
  const passed = (r) => ['success', 'skipped', 'neutral'].includes(r.conclusion);
  const red = mine.find((r) => !passed(r) && r.conclusion !== 'cancelled');
  if (red) return { state: 'red', run: red };
  const cancelled = mine.find((r) => r.conclusion === 'cancelled');
  if (cancelled) return { state: 'cancelled', run: cancelled };
  return { state: 'green', run: mine[0] };
}

/**
 * Run one verb. `opts`: plan, title, bodyFile, sha, wait, log, branch. Resolves to { code, lines } — lines to print.
 */
export async function forge(root, config, verb, opts = {}) {
  const branch = opts.branch ?? currentBranch(root);
  const none = config.forge === 'none';
  const lines = [];
  switch (verb) {
    case 'pr-open': {
      if (none) return { code: 0, lines: ['forge none: no pull request; the lane is its branch'] };
      if (!opts.plan) throw usage('pr-open needs --plan <the lane plan>; the body is built from it');
      if (!existsSync(opts.plan)) throw usage(`--plan ${opts.plan}: no such file`);
      const pr = prFromPlan(root, opts.plan);
      const title = opts.title ?? pr.title;
      const open = JSON.parse(gh(root, ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--limit', '1']) || '[]');
      if (open.length) return { code: 0, lines: [open[0].url] };
      // A lane just opened has no commit of its own, and a forge refuses a pull request with nothing in it:
      // the pull request waits for the first step, whose build opens it with the same verb.
      git(root, ['fetch', '-q', 'origin', config.defaultBranch]);
      // What the forge compares is origin's branch, not this checkout's.
      const head = remoteHead(root, branch) ?? branch;
      const ahead = git(root, ['rev-list', '--count', `origin/${config.defaultBranch}..${head}`]);
      if (ahead.status === 0 && ahead.stdout.trim() === '0') {
        return { code: 0, lines: [`no commits on ${branch} beyond ${config.defaultBranch} yet: the pull request opens with the first step`] };
      }
      const dir = mkdtempSync(path.join(tmpdir(), 'slipway-pr-'));
      try {
        const body = path.join(dir, 'body.md');
        writeFileSync(body, pr.body);
        const url = gh(root, ['pr', 'create', '--draft', '--base', config.defaultBranch, '--head', branch, '--title', title, '--body-file', body]);
        return { code: 0, lines: [url.split('\n').at(-1)] };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    case 'pr': {
      if (none) return { code: 0, lines: ['forge none: no pull request'] };
      const pr = JSON.parse(gh(root, ['pr', 'view', branch, '--json', 'number,url,state,isDraft,mergeable,mergeStateStatus,headRefOid']));
      return { code: 0, lines: [`#${pr.number} ${pr.state.toLowerCase()}${pr.isDraft ? ' draft' : ''} mergeable=${pr.mergeable} ${pr.url}`] };
    }
    case 'comment': {
      if (!opts.bodyFile) throw usage('comment needs --body-file');
      if (none) {
        const file = localComments(root, branch);
        mkdirSync(path.dirname(file), { recursive: true });
        appendFileSync(file, JSON.stringify(readFileSync(opts.bodyFile, 'utf8')) + '\n');
        return { code: 0, lines: [`forge none: recorded in ${file}`] };
      }
      return { code: 0, lines: [gh(root, ['pr', 'comment', branch, '--body-file', opts.bodyFile])] };
    }
    case 'comments': {
      let bodies;
      if (none) {
        bodies = readLocalComments(localComments(root, branch));
      } else {
        bodies = JSON.parse(gh(root, ['pr', 'view', branch, '--json', 'comments'])).comments.map((c) => c.body);
      }
      return { code: 0, lines: bodies.map((b) => b.trimStart().split(/\r?\n/)[0]) };
    }
    case 'ready': {
      if (none) return { code: 0, lines: ['forge none: nothing to mark ready'] };
      gh(root, ['pr', 'ready', branch]);
      return { code: 0, lines: ['ready'] };
    }
    case 'merge': {
      if (none) return localMerge(root, config, branch);
      gh(root, ['pr', 'merge', branch, config.merge === 'squash' ? '--squash' : '--merge']);
      git(root, ['fetch', '-q', 'origin', config.defaultBranch]);
      return { code: 0, lines: [`merged ${branch} into ${config.defaultBranch}`] };
    }
    case 'run': {
      if (none) return { code: 0, lines: ['off: forge none runs no CI'] };
      let sha = opts.sha ?? remoteHead(root, branch);
      if (!sha) return { code: 3, lines: [`none: ${branch} is not on origin`] };
      if (opts.sha) {
        const full = git(root, ['rev-parse', '--verify', '-q', `${opts.sha}^{commit}`]);
        if (full.status !== 0) throw usage(`--sha ${opts.sha}: not a commit git knows`);
        sha = full.stdout.trim();
      }
      const args = ['run', 'list', '--commit', sha, '--json', 'databaseId,headSha,status,conclusion,url,createdAt,workflowName', '--limit', '50'];
      if (config.ci.workflow) args.push('--workflow', config.ci.workflow);
      const deadline = Date.now() + (opts.noneGraceMs ?? 180_000);
      for (;;) {
        const s = runState(JSON.parse(gh(root, args) || '[]'), sha);
        const settled = s.state !== 'running' && !(s.state === 'none' && Date.now() < deadline);
        if (!opts.wait || settled) {
          lines.push(`${s.state} ${sha.slice(0, 12)}${s.run ? ` ${s.run.url}` : ''}`);
          if (s.state === 'red' && opts.log) lines.push(gh(root, ['run', 'view', String(s.run.databaseId), '--log-failed']));
          return { code: { green: 0, red: 1 }[s.state] ?? 3, lines };
        }
        await sleep(opts.pollMs ?? 20_000);
      }
    }
    default:
      throw usage('slipway forge pr-open --plan <plan> [--title <t>] | pr | comment --body-file <f> | comments | ready | merge | run [--sha <sha>] [--wait] [--log]');
  }
}

/** forge none: merge the lane into the default branch with a merge commit, where that branch is checked out (§4.5 step 7). */
function localMerge(root, config, branch) {
  const target = config.defaultBranch;
  if (branch === target) throw usage(`run the merge from the lane's branch, not ${target}`);
  const dir = worktreeOn(root, target);
  if (!dir) throw usage(`no worktree has ${target} checked out; check it out in the main checkout first`);
  const status = git(dir, ['status', '--porcelain', '--untracked-files=no']);
  if (status.stdout.trim()) throw usage(`${dir} has uncommitted changes on ${target}`);
  if (hasOrigin(dir)) {
    // Bring the default branch up to origin's first, or the push after the merge is refused.
    git(dir, ['fetch', '-q', 'origin', target]);
    const ff = git(dir, ['merge', '--ff-only', '-q', `origin/${target}`]);
    if (ff.status !== 0) throw new Error(`${target} in ${dir} has diverged from origin/${target}: ${(ff.stderr || ff.stdout).trim()}`);
  }
  const m = git(dir, ['merge', '--no-ff', '-m', `Merge branch '${branch}'`, branch]);
  if (m.status !== 0) {
    git(dir, ['merge', '--abort']);
    throw new Error(`git merge --no-ff ${branch}: ${(m.stderr || m.stdout).trim()}`);
  }
  const lines = [`merged ${branch} into ${target} in ${dir}`];
  if (hasOrigin(dir)) {
    const p = git(dir, ['push', 'origin', target]);
    if (p.status !== 0) throw new Error(`git push origin ${target}: ${p.stderr.trim()}`);
    lines.push(`pushed ${target}`);
  }
  return { code: 0, lines };
}
