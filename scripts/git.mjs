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

/** How long a fetch for reading may take before the refs already here are read instead. */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * The branches origin has, fetched first, as short names. None when there is no origin; when the fetch fails or
 * times out, as offline or where it would ask for a credential, the remote-tracking refs already here.
 */
export function remoteBranches(cwd) {
  if (tryGit(cwd, ['remote', 'get-url', 'origin']) === null) return [];
  // Never a prompt: not on the terminal, not from ssh (unless the repository sets its own ssh command), not from a
  // credential manager's window. A fetch that would ask fails, and the timeout ends one that hangs regardless.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  if (!env.GIT_SSH_COMMAND && tryGit(cwd, ['config', 'core.sshCommand']) === null) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  try {
    execFileSync('git', ['-c', 'credential.interactive=never', 'fetch', '-q', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*'], {
      cwd,
      stdio: 'ignore',
      env,
      timeout: FETCH_TIMEOUT_MS,
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

/** The names of the files in a directory that `ref` changes since its merge base with `base`, or null when either is unknown. */
export function changedFiles(cwd, base, ref, dir) {
  const out = tryGit(cwd, ['diff', '--name-only', '--relative', `${base}...${ref}`, '--', `${dir}/`]);
  return out === null ? null : out.split('\n').filter(Boolean).map((p) => path.posix.basename(p));
}

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
