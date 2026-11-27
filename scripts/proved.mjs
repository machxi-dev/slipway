// The plugin's half of the step check: the tree a green run proved, and what changed since (docs/design.md §3.3, §14).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function git(cwd, args, env) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const must = (cwd, args, env) => {
  const r = git(cwd, args, env);
  if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.err}`);
  return r.out;
};

/** This worktree's own git directory: the record is never shared with another worktree (§14). */
export const stateDir = (root) => path.join(path.resolve(root, must(root, ['rev-parse', '--git-dir'])), 'slipway');
const recordFile = (root) => path.join(stateDir(root), 'proved.json');

/** The tree of the working copy as it stands: tracked and untracked files, ignored ones left out. */
export function workingTree(root) {
  const dir = stateDir(root);
  mkdirSync(dir, { recursive: true });
  const index = path.join(dir, `index.${process.pid}`);
  const real = path.resolve(root, must(root, ['rev-parse', '--git-path', 'index']));
  try {
    if (existsSync(real)) copyFileSync(real, index);
    must(root, ['add', '-A', '--', '.'], { GIT_INDEX_FILE: index });
    return must(root, ['write-tree'], { GIT_INDEX_FILE: index });
  } finally {
    rmSync(index, { force: true });
  }
}

/** The last green run's record, when it can still be trusted: its head an ancestor of HEAD, its tree still in git. */
export function usableRecord(root) {
  const file = recordFile(root);
  if (!existsSync(file)) return null;
  let rec;
  try {
    rec = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!rec?.head || !rec?.tree) return null;
  if (!git(root, ['merge-base', '--is-ancestor', rec.head, 'HEAD']).ok) return null;
  if (!git(root, ['cat-file', '-e', `${rec.tree}^{tree}`]).ok) return null;
  return rec;
}

/**
 * What a step check runs against: { base, why, current, changed }. `base` is a tree id; `why` says which base
 * it is, for the first line of the output; `changed` lists the repository-relative paths that differ.
 */
export function stepBase(root, config, { base } = {}) {
  const current = workingTree(root);
  const short = (sha) => sha.slice(0, 12);
  let tree;
  let why;
  if (base) {
    const r = git(root, ['rev-parse', '--verify', '-q', `${base}^{tree}`]);
    if (!r.ok) throw Object.assign(new Error(`--base ${base}: not a commit or tree git knows`), { code: 'EUSAGE' });
    tree = r.out;
    why = `--base ${base}`;
  } else {
    const rec = usableRecord(root);
    if (rec) {
      tree = rec.tree;
      why = `the tree proved green at ${rec.at} on ${short(rec.head)}`;
    } else {
      const remote = `origin/${config.defaultBranch}`;
      const target = git(root, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}`]).ok ? remote : config.defaultBranch;
      const mb = git(root, ['merge-base', 'HEAD', target]);
      if (mb.ok) {
        tree = must(root, ['rev-parse', `${mb.out}^{tree}`]);
        why = `the merge base with ${target} (${short(mb.out)}); no green run recorded on this history`;
      } else {
        // No common history (or no such branch): everything is changed.
        tree = spawnSync('git', ['mktree'], { cwd: root, input: '', encoding: 'utf8' }).stdout.trim();
        why = `nothing: ${target} has no history in common with HEAD`;
      }
    }
  }
  const diff = must(root, ['diff', '--name-only', '--no-renames', '-z', tree, current]);
  const changed = diff.split('\0').filter(Boolean);
  return { base: tree, why, current, changed };
}

/** Record a green run: the head and the tree it proved, in this worktree's git directory. */
export function recordGreen(root, tree) {
  const head = must(root, ['rev-parse', 'HEAD']);
  mkdirSync(stateDir(root), { recursive: true });
  writeFileSync(recordFile(root), `${JSON.stringify({ head, tree, at: new Date().toISOString() })}\n`);
}

/** Write the changed paths for the repository's step-check command, one per line. Returns the file. */
export function writeChanged(root, changed) {
  const file = path.join(stateDir(root), 'changed-paths');
  writeFileSync(file, changed.length ? `${changed.join('\n')}\n` : '');
  return file;
}
