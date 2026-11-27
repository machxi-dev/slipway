// Test helpers shared by the scripts' tests: temporary git repositories and running bin/slipway.
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(PLUGIN_ROOT, 'bin', 'slipway');

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A fresh git repository with one commit on `main`, removed when the test ends. */
export function tempRepo(t, name = 'repo') {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'slipway-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const repo = path.join(parent, name);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Slipway test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'root');
  return repo;
}

/** Run bin/slipway through node, as the Bash tool's PATH entry would. */
export function slipway(cwd, args, { env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...process.env, ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
