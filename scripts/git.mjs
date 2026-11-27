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

/** The main checkout's root: lane worktrees sit beside it and copy their files from it. */
export function mainRoot(cwd) {
  const common = commonDir(cwd);
  return path.basename(common) === '.git' ? path.dirname(common) : path.resolve(cwd);
}
