import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { quoteArg } from './run.mjs';
import { PLUGIN_ROOT, git, slipway, tempRepo } from './testing.mjs';

// probe.mjs records its cwd, arguments and SLIPWAY_* environment, then exits with PROBE_EXIT.
const PROBE = `import { writeFileSync } from 'node:fs';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('SLIPWAY_')));
writeFileSync(process.env.PROBE_OUT, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), env }));
process.exit(Number(process.env.PROBE_EXIT ?? 0));
`;

function setup(t, commands = {}) {
  const repo = tempRepo(t);
  writeFileSync(path.join(repo, 'probe.mjs'), PROBE);
  const config = {
    version: 1,
    tagPrefix: 'app',
    commands: { check: 'node probe.mjs', 'step-check': 'node probe.mjs step', gate: 'node probe.mjs gate', ...commands },
  };
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(config));
  const out = path.join(repo, '..', 'probe.json');
  return { repo, out, env: { PROBE_OUT: out } };
}
const probed = (out) => JSON.parse(readFileSync(out, 'utf8'));

test('a command runs from the repository root with the SLIPWAY_* variables', (t) => {
  const { repo, out, env } = setup(t);
  mkdirSync(path.join(repo, 'deep', 'er'), { recursive: true });
  const r = slipway(path.join(repo, 'deep', 'er'), ['run', 'step-check'], { env });
  assert.equal(r.code, 0, r.stderr);
  const p = probed(out);
  assert.equal(path.resolve(p.cwd), repo);
  assert.deepEqual(p.args, ['step']);
  assert.deepEqual(p.env, {
    SLIPWAY_ROOT: repo,
    SLIPWAY_COMMAND: 'step-check',
    SLIPWAY_PLUGIN_ROOT: PLUGIN_ROOT,
    SLIPWAY_BRANCH: 'main',
    SLIPWAY_BASE: p.env.SLIPWAY_BASE,
    SLIPWAY_CHANGED_PATHS: p.env.SLIPWAY_CHANGED_PATHS,
  });
  assert.match(p.env.SLIPWAY_BASE, /^[0-9a-f]{40,64}$/);
});

test('a SLIPWAY_BRANCH or SLIPWAY_LANE inherited from an outer run is not passed on when it does not apply', (t) => {
  const { repo, out, env } = setup(t);
  git(repo, 'checkout', '-q', '--detach');
  const r = slipway(repo, ['run', 'check'], { env: { ...env, SLIPWAY_BRANCH: 'lane/D9', SLIPWAY_LANE: 'd9' } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(probed(out).env.SLIPWAY_BRANCH, undefined);
  assert.equal(probed(out).env.SLIPWAY_LANE, undefined);
});

test('on a lane branch SLIPWAY_LANE names the lane; on a detached HEAD there is no branch', (t) => {
  const { repo, out, env } = setup(t);
  git(repo, 'checkout', '-q', '-b', 'lane/D45');
  assert.equal(slipway(repo, ['run', 'check'], { env }).code, 0);
  assert.equal(probed(out).env.SLIPWAY_BRANCH, 'lane/D45');
  assert.equal(probed(out).env.SLIPWAY_LANE, 'd45');
  git(repo, 'checkout', '-q', '--detach');
  assert.equal(slipway(repo, ['run', 'check'], { env }).code, 0);
  assert.equal(probed(out).env.SLIPWAY_BRANCH, undefined);
  assert.equal(probed(out).env.SLIPWAY_LANE, undefined);
});

test('extra arguments reach the command intact through the platform shell', (t) => {
  const { repo, out, env } = setup(t);
  const args = ['plain', 'two words', "it's", 'semi;colon', 'a&b', '$HOME', 'x"y', '', '%PATH%', '100%', 'C:\\dir\\f.txt'];
  const r = slipway(repo, ['run', 'check', ...args], { env });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(probed(out).args, args);
});

test("the command's exit code is slipway's", (t) => {
  const { repo, env } = setup(t);
  assert.equal(slipway(repo, ['run', 'gate'], { env: { ...env, PROBE_EXIT: '3' } }).code, 3);
});

test('shell syntax in a configured command works on every platform', (t) => {
  const { repo, out, env } = setup(t, { both: 'node probe.mjs one && node probe.mjs two' });
  assert.equal(slipway(repo, ['run', 'both'], { env }).code, 0);
  assert.deepEqual(probed(out).args, ['two']);
  const failing = setup(t, { both: 'node probe.mjs one && node probe.mjs two' });
  assert.equal(slipway(failing.repo, ['run', 'both'], { env: { ...failing.env, PROBE_EXIT: '4' } }).code, 4);
  assert.deepEqual(probed(failing.out).args, ['one']);
});

test('run with no name lists the commands, marking the locked ones', (t) => {
  const { repo } = setup(t);
  const config = JSON.parse(readFileSync(path.join(repo, 'slipway.config.json'), 'utf8'));
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify({ ...config, locks: { tiers: ['gate'] } }));
  const r = slipway(repo, ['run']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'check: node probe.mjs\nstep-check: node probe.mjs step\ngate (locked): node probe.mjs gate\n');
});

test('usage problems exit 2 with a plain message', (t) => {
  const { repo } = setup(t);
  let r = slipway(repo, ['run', 'deploy']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no command "deploy" in slipway.config.json; it names: check, step-check, gate/);
  r = slipway(repo, ['run', 'constructor']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no command "constructor"/);
  r = slipway(repo, ['run', 'gate'], { env: { SLIPWAY_LOCK_TIMEOUT: 'soon' } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /SLIPWAY_LOCK_TIMEOUT must be a number of seconds/);
  r = slipway(repo, ['frobnicate']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown verb "frobnicate"/);
  r = slipway(tempRepo(t), ['run', 'check']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /run \/slipway:init first/);
  r = slipway(path.dirname(repo), ['run', 'check']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not inside a git repository/);
});

test('config prints the normalized config; version prints the plugin version', (t) => {
  const { repo } = setup(t);
  const c = JSON.parse(slipway(repo, ['config']).stdout);
  assert.equal(c.lane.branch, 'lane/D{n}');
  const manifest = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(slipway(repo, ['--version']).stdout.trim(), manifest.version);
});

test('quoteArg leaves plain words alone and quotes the rest for each shell', () => {
  assert.equal(quoteArg('src/a.ts', 'linux'), 'src/a.ts');
  assert.equal(quoteArg("it's", 'linux'), `'it'\\''s'`);
  assert.equal(quoteArg('', 'linux'), `''`);
  assert.equal(quoteArg('two words', 'win32'), '"two words"');
  assert.equal(quoteArg('x"y', 'win32'), '"x""y"');
  assert.equal(quoteArg('%PATH%', 'win32'), '""^%"PATH"^%""');
  assert.equal(quoteArg('C:\\a\\b', 'win32'), 'C:\\a\\b');
});
