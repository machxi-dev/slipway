import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN_ROOT, git, slipway, tempRepo } from './testing.mjs';

const PLAN = readFileSync(new URL('./fixtures/plan.md', import.meta.url), 'utf8');
const hook = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'hooks/hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0];
/** Run the hook as Claude Code would: exec form, the plugin root substituted, the session's cwd on stdin. */
const orient = (cwd) =>
  spawnSync(
    hook.command === 'node' ? process.execPath : hook.command,
    hook.args.map((a) => a.replace('${CLAUDE_PLUGIN_ROOT}', PLUGIN_ROOT)),
    { input: JSON.stringify({ cwd, hook_event_name: 'SessionStart' }), encoding: 'utf8', cwd: path.parse(cwd).root },
  );

test('the hook is exec form: node with args, no shell (§11)', () => {
  assert.equal(hook.type, 'command');
  assert.equal(hook.command, 'node');
  assert.deepEqual(hook.args, ['${CLAUDE_PLUGIN_ROOT}/scripts/orient.mjs']);
});

test('on a lane it names the lane and the next step; elsewhere the open lanes and planned rows', (t) => {
  const repo = tempRepo(t);
  assert.equal(slipway(repo, ['init', '--check', 'x']).code, 0);
  slipway(repo, ['ledger', 'add', 'Refunds']);
  writeFileSync(path.join(repo, 'docs/plan/D1.md'), PLAN.replace('# D4.', '# D1.').replace('`lane/D4`', '`lane/D1`'));
  slipway(repo, ['ledger', 'set', 'D1', 'in progress']);
  let r = orient(repo);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'Slipway: not on a lane. Open lanes: D1.\nPlanned rows: 0 — /slipway:plan adds more.\n');
  git(repo, 'checkout', '-q', '-b', 'lane/D1');
  r = orient(repo);
  assert.equal(r.stdout, 'Slipway: this is lane D1, Refunds (CI: at-ship).\nNext step: 2. The refund endpoint — /slipway:build\nPlanned rows: 0 — /slipway:plan adds more.\n');
});

test('outside a Slipway repository, or with a broken config, it prints nothing and succeeds', (t) => {
  const repo = tempRepo(t);
  let r = orient(repo);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  writeFileSync(path.join(repo, 'slipway.config.json'), '{ broken');
  r = orient(repo);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
