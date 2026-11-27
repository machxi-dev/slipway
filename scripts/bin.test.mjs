// bin/: the extensionless runner for Git Bash and bin/slipway.cmd for cmd.exe and the PowerShell tool (§13.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN_ROOT, tempRepo } from './testing.mjs';

const BIN_DIR = path.join(PLUGIN_ROOT, 'bin');
const CMD = path.join(BIN_DIR, 'slipway.cmd');
const VERSION = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const onWindows = { skip: process.platform !== 'win32' && 'cmd.exe and powershell.exe are Windows-only' };

test('bin/ holds the runner and its .cmd shim, and no .ps1 that PowerShell would pick first', () => {
  assert.deepEqual(readdirSync(BIN_DIR).sort(), ['slipway', 'slipway.cmd']);
});

test('bin/slipway.cmd has CRLF line endings, so cmd finds its :find_dp0 label', () => {
  const text = readFileSync(CMD, 'latin1');
  assert.ok(text.endsWith('\r\n'), 'the last line must end in CRLF');
  assert.doesNotMatch(text, /(^|[^\r])\n/, 'every line must end in CRLF');
});

test('bin/slipway.cmd finds its folder from its own path, never from CLAUDE_PLUGIN_ROOT', () => {
  assert.doesNotMatch(readFileSync(CMD, 'utf8'), /CLAUDE_PLUGIN_ROOT/);
});

test('bin/slipway stays LF, so its shebang does not ask env for node\\r', () => {
  assert.doesNotMatch(readFileSync(path.join(BIN_DIR, 'slipway'), 'latin1'), /\r/);
});

/** process.env with bin/ first on PATH, whatever case the platform spells PATH in. */
function envWithBinOnPath() {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = `${BIN_DIR}${path.delimiter}${env[key] ?? ''}`;
  return env;
}

// Node refuses to spawn a .cmd without a shell, so each run names its shell explicitly.
function viaCmd(cwd, line, env = process.env) {
  // /s strips the outer quotes and keeps the rest of the line as written.
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { cwd, env, encoding: 'utf8', windowsVerbatimArguments: true });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function viaPowerShell(cwd, command, env = process.env) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${command}; exit $LASTEXITCODE`], { cwd, env, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const psQuote = (s) => `'${s.replaceAll("'", "''")}'`;

test('cmd.exe runs bin/slipway.cmd by path and on PATH', onWindows, (t) => {
  const repo = tempRepo(t);
  let r = viaCmd(repo, `"${CMD}" --version`);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), VERSION);

  r = viaCmd(repo, 'slipway --version', envWithBinOnPath());
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), VERSION);

  r = viaCmd(repo, `"${CMD}" "two words"`);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown verb "two words"/);
});

test('powershell.exe runs bin/slipway.cmd by path and on PATH, and keeps quoted arguments and exit codes', onWindows, (t) => {
  const repo = tempRepo(t);
  let r = viaPowerShell(repo, `& ${psQuote(CMD)} --version`);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), VERSION);

  // How the PowerShell tool finds it: bare name, bin/ on PATH, .cmd through PATHEXT.
  r = viaPowerShell(repo, 'slipway --version', envWithBinOnPath());
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), VERSION);

  r = viaPowerShell(repo, `& ${psQuote(CMD)} 'two words' one`);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown verb "two words"/);
});
