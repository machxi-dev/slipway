// The few git facts the scripts need, read through git itself.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const gitOut = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The working tree's root, or null outside a git repository. */
export function repoRoot(cwd) {
  try {
    return path.resolve(gitOut(cwd, ['rev-parse', '--show-toplevel']));
  } catch {
    return null;
  }
}

/** The git directory shared by every worktree of the repository (where the lock lives). */
export const commonDir = (cwd) => path.resolve(cwd, gitOut(cwd, ['rev-parse', '--git-common-dir']));

/** The current branch's short name, or null on a detached HEAD. */
export function currentBranch(cwd) {
  try {
    return gitOut(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']) || null;
  } catch {
    return null;
  }
}

const tryGit = (cwd, args) => {
  try {
    return gitOut(cwd, args);
  } catch {
    return null;
  }
};

/**
 * The branches origin has whose names match `pattern` (one `*`), fetched first, as short names. None when there is
 * no origin; when the fetch fails, as offline, the remote-tracking refs already here.
 */
export function remoteBranches(cwd, pattern) {
  if (tryGit(cwd, ['remote', 'get-url', 'origin']) === null) return [];
  try {
    // Never a prompt for credentials: a fetch that needs one fails, and the refs already here stand.
    execFileSync('git', ['fetch', '-q', '--prune', 'origin', `+refs/heads/${pattern}:refs/remotes/origin/${pattern}`], {
      cwd,
      stdio: 'ignore',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    // Read what is here.
  }
  const prefix = 'refs/remotes/origin/';
  return (tryGit(cwd, ['for-each-ref', '--format=%(refname)', prefix]) ?? '')
    .split('\n')
    .filter((r) => r.startsWith(prefix))
    .map((r) => r.slice(prefix.length));
}

/** A file's text at a ref, by its path from cwd, or null when the ref has no such file. */
export const showFile = (cwd, ref, file) => tryGit(cwd, ['show', `${ref}:./${file}`]);

/** The names of the files in a directory at a ref, by its path from cwd; none when the ref has no such directory. */
export const listFiles = (cwd, ref, dir) =>
  (tryGit(cwd, ['ls-tree', '--name-only', ref, '--', `${dir}/`]) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((p) => path.posix.basename(p));

/** The main checkout's root: lane worktrees sit beside it and copy their files from it. */
export function mainRoot(cwd) {
  const common = commonDir(cwd);
  return path.basename(common) === '.git' ? path.dirname(common) : path.resolve(cwd);
}
