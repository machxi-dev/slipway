// `slipway worktree D<n>`: a lane's worktree, its copied files and its setup (docs/design.md §3.3, §4.2, §14).
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { laneWorktree } from './config.mjs';
import { mainRoot } from './git.mjs';
import { findLane } from './lane.mjs';
import { localComments } from './forge.mjs';
import { slipwayEnv } from './run.mjs';

const usage = (message) => Object.assign(new Error(message), { code: 'EUSAGE' });
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const ok = (cwd, args) => git(cwd, args).status === 0;

/** Whether git still lists `dir` as one of the repository's worktrees. */
function registered(main, dir) {
  // git prints the real path; the lane's may run through a symlink (macOS /var is /private/var).
  const norm = (p) => {
    let r = path.resolve(p);
    try {
      r = realpathSync.native(r);
    } catch {}
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const out = git(main, ['worktree', 'list', '--porcelain']).stdout ?? '';
  return out.split('\n').some((l) => l.startsWith('worktree ') && norm(l.slice(9)) === norm(dir));
}

/**
 * Make (or reuse) the lane's worktree. Returns { path, branch, created, copied, skipped, setup }, where setup
 * is the lane.setup exit code, or null when it did not run. `log` receives progress lines.
 */
export function makeWorktree(root, config, arg, { pluginRoot, log = () => {} } = {}) {
  const lane = findLane(root, config, arg);
  const main = mainRoot(root);
  const dir = laneWorktree(config, main, lane.n);
  const out = { path: dir, branch: lane.branch, created: false, copied: [], skipped: [], setup: null };
  if (existsSync(dir)) {
    const head = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const top = git(dir, ['rev-parse', '--show-toplevel']);
    if (head.status !== 0 || path.resolve(top.stdout.trim()) !== path.resolve(dir)) throw usage(`${dir} exists and is not a worktree; move it aside`);
    if (head.stdout.trim() !== lane.branch) throw usage(`${dir} is a worktree on ${head.stdout.trim()}, not ${lane.branch}`);
    return out;
  }
  let args;
  if (ok(main, ['show-ref', '--verify', '-q', `refs/heads/${lane.branch}`])) args = [dir, lane.branch];
  else if (ok(main, ['show-ref', '--verify', '-q', `refs/remotes/origin/${lane.branch}`])) args = ['-b', lane.branch, dir, `origin/${lane.branch}`];
  else {
    // A new lane starts from the default branch, never from whatever this checkout has.
    const from = ok(main, ['show-ref', '--verify', '-q', `refs/remotes/origin/${config.defaultBranch}`]) ? `origin/${config.defaultBranch}` : config.defaultBranch;
    args = ['-b', lane.branch, '--no-track', dir, from];
  }
  const r = git(root, ['worktree', 'add', '-q', ...args]);
  if (r.status !== 0) throw new Error(`git worktree add: ${r.stderr.trim()}`);
  out.created = true;
  log(`worktree ${dir} on ${lane.branch}`);
  // Files the lane needs that git does not carry; named, never printed (§14).
  for (const f of config.lane.copy) {
    const from = path.join(main, f);
    const to = path.join(dir, f);
    if (!existsSync(from)) {
      out.skipped.push(f);
      log(`skipped ${f}: not in ${main}`);
    } else if (existsSync(to)) log(`kept ${f}`);
    else {
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(from, to);
      out.copied.push(f);
      log(`copied ${f}`);
    }
  }
  if (config.lane.setup) {
    log(`lane.setup: ${config.lane.setup}`);
    const env = slipwayEnv({ root: dir, config, name: 'lane.setup', pluginRoot });
    const s = spawnSync(config.lane.setup, { cwd: dir, shell: true, stdio: 'inherit', env });
    out.setup = s.status ?? 1;
  }
  return out;
}

/** Remove a shipped lane's worktree and branch (§4.5 step 9). Refuses a worktree with changes. */
export function removeWorktree(root, config, arg, { log = () => {} } = {}) {
  const lane = findLane(root, config, arg);
  const main = mainRoot(root);
  const dir = laneWorktree(config, main, lane.n);
  // A session that shipped from the lane's worktree removes it from there: git works from the main checkout,
  // and this process leaves the directory first. A shell still inside it (on Windows) can hold it open.
  if (path.resolve(root) === path.resolve(dir)) process.chdir(main);
  if (existsSync(dir)) {
    if (registered(main, dir)) {
      const r = git(main, ['worktree', 'remove', dir]);
      // On Windows git empties the folder and drops the worktree, then fails to delete a folder a shell holds
      // open. That is done enough: the branch can go, and the empty folder goes once the shell lets it.
      if (r.status !== 0 && registered(main, dir)) throw new Error(`git worktree remove: ${r.stderr.trim()}; close any shell inside ${dir}, then run \`slipway worktree remove D${lane.n}\` from ${main}`);
    }
    if (existsSync(dir)) {
      try {
        rmdirSync(dir);
      } catch {
        log(`left ${dir}: it is in use or not empty; delete it when no shell is inside it`);
      }
    }
    if (!existsSync(dir)) log(`removed ${dir}`);
  }
  if (ok(main, ['show-ref', '--verify', '-q', `refs/heads/${lane.branch}`])) {
    const r = git(main, ['branch', '-d', lane.branch]);
    if (r.status !== 0) throw new Error(`git branch -d ${lane.branch}: ${r.stderr.trim()}`);
    log(`deleted branch ${lane.branch}`);
  }
  if (ok(main, ['remote', 'get-url', 'origin']) && ok(main, ['ls-remote', '--exit-code', '--heads', 'origin', lane.branch])) {
    const r = git(main, ['push', 'origin', '--delete', lane.branch]);
    if (r.status !== 0) throw new Error(`git push origin --delete ${lane.branch}: ${r.stderr.trim()}`);
    log(`deleted origin/${lane.branch}`);
  }
  // Last, so a failed branch delete keeps the lane's record of which steps were reviewed.
  rmSync(localComments(main, lane.branch), { force: true });
}
