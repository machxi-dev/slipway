import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError, loadConfig, normalize, laneFromBranch, laneBranch, laneWorktree } from './config.mjs';
import { tempRepo } from './testing.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/config/${name}.json`, import.meta.url), 'utf8'));
const problemsOf = (raw) => {
  try {
    normalize(raw);
  } catch (err) {
    assert.ok(err instanceof ConfigError, err);
    return err.problems;
  }
  assert.fail('expected a ConfigError');
};
const minimal = () => ({ version: 1, tagPrefix: 'x', commands: { check: 'c', 'step-check': 's', gate: 'g' } });

test('the §3.3 monorepo config loads from a repository', (t) => {
  const repo = tempRepo(t);
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(fixture('monorepo')));
  const c = loadConfig(repo);
  assert.equal(c.tagPrefix, 'app');
  assert.equal(c.lane.setup, 'pnpm db:lane');
  assert.deepEqual(c.locks.tiers, ['step-check', 'gate']);
  assert.equal(c.ci.default, 'at-ship');
  assert.equal(c.release, null);
  assert.deepEqual(c.areas.frontend.skills, ['frontend-conventions']);
});

test("the §9 config (this repository's own) loads, with release in place of tagPrefix", () => {
  const c = normalize(fixture('slipway'));
  assert.equal(c.tagPrefix, null);
  assert.equal(c.docs.specs, null);
  assert.equal(c.lane.setup, null);
  assert.deepEqual(c.lane.copy, []);
  assert.deepEqual(c.locks.tiers, []);
  assert.deepEqual(c.release, { tag: 'v{version}', versionFile: '.claude-plugin/plugin.json', also: ['.claude-plugin/marketplace.json'] });
  assert.deepEqual(c.areas.skills, { paths: ['skills/**'], skills: [] });
});

test('a minimal config takes every default', () => {
  const c = normalize(minimal());
  assert.equal(c.defaultBranch, 'main');
  assert.equal(c.forge, 'github');
  assert.deepEqual(c.docs, { records: 'docs/adr', plans: 'docs/plan', digests: 'docs/rules', specs: 'docs/specs' });
  assert.deepEqual(c.lane, { branch: 'lane/D{n}', worktree: '../{repo}-D{n}', copy: [], setup: null });
  assert.deepEqual(c.ci, { default: 'on', workflow: null, main: 'on' });
  assert.equal(c.merge, 'merge-commit');
  assert.deepEqual(c.areas, {});
});

test('forge none defaults CI to off and refuses any other value', () => {
  assert.equal(normalize({ ...minimal(), forge: 'none' }).ci.default, 'off');
  assert.deepEqual(problemsOf({ ...minimal(), forge: 'none', ci: { default: 'at-ship' } }), [
    'ci.default: must be "off" when forge is "none" (§3.3)',
  ]);
});

test('the three commands the skills call are required', () => {
  assert.deepEqual(problemsOf({ ...minimal(), commands: { check: 'c' } }), ['commands.step-check: required', 'commands.gate: required']);
  assert.match(problemsOf({ version: 1, tagPrefix: 'x' })[0], /^commands: required/);
});

test('every problem is reported at once, with its path', () => {
  const problems = problemsOf({
    version: 2,
    forge: 'gitlab',
    tagPrefix: 'x',
    docs: { records: '', plans: 'docs/x', digests: 'docs/x/' },
    lane: { branch: 'lane/D', setup: 3 },
    commands: { check: 'c', 'step-check': 's', gate: 'g', Bad: 'x' },
    locks: { tiers: ['nope', 'toString'] },
    ci: { default: 'sometimes' },
    merge: 'rebase',
    defaultBranch: 5,
    areas: { web: { skills: ['x'] }, general: { paths: ['x/**'] } },
    extra: true,
  });
  assert.deepEqual(problems, [
    'extra: unknown key',
    'version: must be 1',
    'defaultBranch: must be a non-empty string',
    'forge: must be one of "github", "none"',
    'docs.records: must be a non-empty string',
    'docs.digests: must differ from docs.plans',
    'lane.setup: must be a non-empty string or null',
    'lane.branch: must contain {n} exactly once',
    'commands.Bad: a command name is lower-case letters, digits and hyphens',
    'locks.tiers: "nope" is not a command',
    'locks.tiers: "toString" is not a command',
    'ci.default: must be one of "on", "at-ship", "off"',
    'merge: must be one of "merge-commit", "squash"',
    'areas.web.paths: required',
    'areas.general: "general" is the digest for the whole repository; name the area otherwise',
  ]);
});

test('a tag needs either tagPrefix or a release block', () => {
  const { tagPrefix, ...noPrefix } = minimal();
  assert.deepEqual(problemsOf(noPrefix), ['tagPrefix: required unless release is set (§4.5 step 8)']);
  assert.deepEqual(problemsOf({ ...noPrefix, release: { tag: 'v1' } }), [
    'release.versionFile: required when release is set',
    'release.tag: must contain {version}',
  ]);
});

test('a missing file says to run init; broken JSON names the file', (t) => {
  const repo = tempRepo(t);
  assert.throws(() => loadConfig(repo), { code: 'ENOENT', message: /run \/slipway:init/ });
  writeFileSync(path.join(repo, 'slipway.config.json'), '{ nope');
  assert.throws(() => loadConfig(repo), (err) => err instanceof ConfigError && err.message.includes('not valid JSON'));
});

test('lanes are read from branch names through the lane.branch pattern', () => {
  const c = normalize(minimal());
  assert.deepEqual(laneFromBranch(c, 'lane/D45'), { n: 45, id: 'd45' });
  assert.equal(laneFromBranch(c, 'main'), null);
  assert.equal(laneFromBranch(c, 'lane/D45-x'), null);
  assert.equal(laneFromBranch(c, 'lane/D045'), null);
  assert.deepEqual(laneFromBranch(c, 'lane/D0'), { n: 0, id: 'd0' });
  assert.equal(laneFromBranch(c, 'xlane/D45'), null);
  assert.equal(laneBranch(c, 7), 'lane/D7');
  const dotted = normalize({ ...minimal(), lane: { branch: 'work.{n}+x' } });
  assert.deepEqual(laneFromBranch(dotted, 'work.3+x'), { n: 3, id: 'd3' });
  assert.equal(laneFromBranch(dotted, 'workX3+x'), null);
});

test('a lane worktree resolves beside the repository', () => {
  const c = normalize(minimal());
  const root = path.resolve('/tmp', 'shop');
  assert.equal(laneWorktree(c, root, 12), path.resolve('/tmp', 'shop-D12'));
});
