// `slipway worktree D<n>`: a lane's worktree, its copied files and its setup (docs/design.md §3.3, §4.2, §14).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { laneWorktree } from './config.mjs';
import { mainRoot } from './git.mjs';
import { findLane } from './lane.mjs';
import { slipwayEnv } from './run.mjs';

const usage = (message) => Object.assign(new Error(message), { code: 'EUSAGE' });
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const ok = (cwd, args) => git(cwd, args).status === 0;

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
  else args = ['-b', lane.branch, dir, 'HEAD'];
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
  if (path.resolve(root) === path.resolve(dir)) throw usage('run this from the main checkout, not from the lane worktree it removes');
  if (existsSync(dir)) {
    const r = git(main, ['worktree', 'remove', dir]);
    if (r.status !== 0) throw new Error(`git worktree remove: ${r.stderr.trim()}`);
    log(`removed ${dir}`);
  }
  if (ok(main, ['show-ref', '--verify', '-q', `refs/heads/${lane.branch}`])) {
    const r = git(main, ['branch', '-d', lane.branch]);
    if (r.status !== 0) throw new Error(`git branch -d ${lane.branch}: ${r.stderr.trim()}`);
    log(`deleted branch ${lane.branch}`);
  }
  if (config.forge !== 'none' && ok(main, ['ls-remote', '--exit-code', '--heads', 'origin', lane.branch])) {
    const r = git(main, ['push', 'origin', '--delete', lane.branch]);
    if (r.status !== 0) throw new Error(`git push origin --delete ${lane.branch}: ${r.stderr.trim()}`);
    log(`deleted origin/${lane.branch}`);
  }
}
