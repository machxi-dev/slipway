import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { claudeVersionWarning, compareVersions, init, parseInitArgs } from './init.mjs';
import { execFileSync } from 'node:child_process';
import { PLUGIN_ROOT, git, slipway, tempRepo } from './testing.mjs';

const read = (repo, p) => readFileSync(path.join(repo, p), 'utf8');
const fixture = (name) => readFileSync(new URL(`./fixtures/config/${name}.json`, import.meta.url), 'utf8');
const quiet = (repo, options) => init(repo, PLUGIN_ROOT, options, { installedClaude: '9.9.9' });

/** Every file under dir, relative, with forward slashes, .git left out. */
function tree(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.name === '.git') return [];
      return e.isDirectory() ? tree(p, base) : [path.relative(base, p).split(path.sep).join('/')];
    })
    .sort();
}

test('init on a new repository writes the config, the ledger, the records index, a digest and its loader', (t) => {
  const repo = tempRepo(t, 'Shop Front');
  const r = slipway(repo, ['init', '--check', 'npm test', '--gate', 'npm run gate']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(tree(repo), [
    '.claude/rules/slipway.md',
    '.claude/settings.json',
    'CLAUDE.md',
    'README.md',
    'docs/adr/0001-the-process.md',
    'docs/adr/README.md',
    'docs/plan/README.md',
    'docs/plan/ROADMAP.md',
    'docs/plan/SHIPPED.md',
    'docs/rules/general.md',
    'docs/specs/.gitkeep',
    'slipway.budget.json',
    'slipway.config.json',
  ]);
  const c = loadConfig(repo);
  assert.equal(c.tagPrefix, 'shop-front');
  assert.deepEqual(c.commands, { check: 'npm test', 'step-check': 'npm test', gate: 'npm run gate' });
  assert.equal(c.defaultBranch, 'main');
  assert.match(read(repo, 'docs/plan/README.md'), /^Tags: `shop-front-D<n>`/m);
  assert.match(read(repo, 'docs/plan/README.md'), /The open lanes are the `in progress` rows\./);
  const loader = read(repo, '.claude/rules/slipway.md');
  assert.ok(!loader.startsWith('---'), 'the general loader has no paths, so it loads in every session');
  // An @ import resolves against the loader's own folder.
  assert.match(loader, /^@\.\.\/\.\.\/docs\/rules\/general\.md$/m);
  assert.deepEqual(JSON.parse(read(repo, '.claude/settings.json')), JSON.parse(read(PLUGIN_ROOT, 'templates/settings-fragment.json')));
  assert.match(read(repo, 'CLAUDE.md'), /A lane closes with `\/slipway:ship`/);
  assert.match(read(repo, 'README.md'), /claude plugin install slipway@slipway --scope project/);
});

test('init run twice changes nothing the second time', (t) => {
  const repo = tempRepo(t);
  quiet(repo, { check: 'make test' });
  const before = Object.fromEntries(tree(repo).map((p) => [p, read(repo, p)]));
  const { actions } = quiet(repo, {});
  assert.ok(actions.every((a) => a.action === 'kept'), JSON.stringify(actions));
  assert.deepEqual(Object.fromEntries(tree(repo).map((p) => [p, read(repo, p)])), before);
});

test('a new config needs --check; unknown options are refused', (t) => {
  const repo = tempRepo(t);
  let r = slipway(repo, ['init']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--check "<command>"/);
  assert.deepEqual(tree(repo), []);
  r = slipway(repo, ['init', '--check', 'x', '--colour', 'blue']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option --colour/);
  assert.deepEqual(parseInitArgs(['--check=cargo test', '--specs', 'none', '--brownfield']), {
    check: 'cargo test',
    specs: 'none',
    brownfield: true,
  });
});

test('an existing config with areas gets one path-scoped loader and digest per area', (t) => {
  const repo = tempRepo(t);
  writeFileSync(path.join(repo, 'slipway.config.json'), fixture('monorepo'));
  quiet(repo, {});
  const api = read(repo, '.claude/rules/slipway-api-and-data.md');
  assert.ok(api.startsWith('---\npaths:\n  - "apps/api/**"\n  - "packages/db/**"\n---\n'), api);
  assert.match(api, /^@\.\.\/\.\.\/docs\/rules\/api-and-data\.md$/m);
  assert.ok(existsSync(path.join(repo, '.claude/rules/slipway-frontend.md')));
  assert.ok(existsSync(path.join(repo, '.claude/rules/slipway.md')));
  assert.match(read(repo, 'docs/rules/frontend.md'), /^# Rules: frontend/);
  assert.match(read(repo, 'docs/plan/README.md'), /^Tags: `app-D<n>`/m);
});

test("a release config (this repository's own) tags by version, and specs: null makes no specs folder", (t) => {
  const repo = tempRepo(t);
  writeFileSync(path.join(repo, 'slipway.config.json'), fixture('slipway'));
  quiet(repo, {});
  assert.match(read(repo, 'docs/plan/README.md'), /^Tags: `v\{version\}`, the version in `\.claude-plugin\/plugin\.json`/m);
  assert.equal(existsSync(path.join(repo, 'docs/specs')), false);
});

test('forge none, custom docs paths and a tag prefix come from the options', (t) => {
  const repo = tempRepo(t);
  quiet(repo, { check: 'cargo test', forge: 'none', tagPrefix: 'crate', records: 'doc/decisions', specs: 'none' });
  const c = loadConfig(repo);
  assert.equal(c.forge, 'none');
  assert.equal(c.ci.default, 'off');
  assert.equal(c.tagPrefix, 'crate');
  assert.equal(c.docs.specs, null);
  assert.ok(existsSync(path.join(repo, 'doc/decisions/README.md')));
});

test('settings, CLAUDE.md and README keep what they had and gain only what is missing', (t) => {
  const repo = tempRepo(t);
  mkdirSync(path.join(repo, '.claude'));
  writeFileSync(
    path.join(repo, '.claude/settings.json'),
    JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'slipway@slipway': false, 'other@x': true } }),
  );
  writeFileSync(path.join(repo, 'CLAUDE.md'), '# House rules\n\nBe kind.\n');
  writeFileSync(path.join(repo, 'README.md'), '# Shop\n');
  const { actions } = quiet(repo, { check: 'make test' });
  const s = JSON.parse(read(repo, '.claude/settings.json'));
  assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] });
  assert.deepEqual(s.enabledPlugins, { 'slipway@slipway': false, 'other@x': true }, 'an operator’s explicit false stays');
  assert.equal(s.extraKnownMarketplaces.slipway.source.repo, 'machxi-dev/slipway');
  assert.ok(read(repo, 'CLAUDE.md').startsWith('# House rules\n\nBe kind.\n\n<!-- slipway -->\n'));
  assert.ok(read(repo, 'README.md').startsWith('# Shop\n\n## Setup\n'));
  for (const p of ['.claude/settings.json', 'CLAUDE.md', 'README.md']) {
    assert.equal(actions.find((a) => a.path === p).action, 'updated', p);
  }
});

test('records already present are adopted with --brownfield, and flagged without it', (t) => {
  const repo = tempRepo(t);
  mkdirSync(path.join(repo, 'docs/adr'), { recursive: true });
  writeFileSync(path.join(repo, 'docs/adr/0001-use-postgres.md'), '# Use Postgres\n');
  writeFileSync(path.join(repo, 'docs/adr/0002-queue.md'), '# Queue\n');
  const plain = quiet(repo, { check: 'make test' });
  assert.match(plain.warnings.join('\n'), /docs\/adr already holds 2 records; run init --brownfield/);
  const brown = quiet(repo, { brownfield: true });
  assert.deepEqual(brown.actions.find((a) => a.action === 'adopted'), {
    action: 'adopted',
    path: 'docs/adr',
    note: '2 existing records, read as records without ## Rules',
  });
  assert.equal(read(repo, 'docs/adr/0001-use-postgres.md'), '# Use Postgres\n');
});

test('init warns when Claude Code is older than the declared minimum, or cannot be run', () => {
  const min = JSON.parse(read(PLUGIN_ROOT, '.claude-plugin/plugin.json')).engines['claude-code'].replace('>=', '');
  assert.equal(claudeVersionWarning(PLUGIN_ROOT, min), null);
  assert.equal(claudeVersionWarning(PLUGIN_ROOT, '99.0.0'), null);
  assert.match(claudeVersionWarning(PLUGIN_ROOT, '2.1.318'), new RegExp(`2\\.1\\.318 is older than ${min.replaceAll('.', '\\.')}`));
  assert.match(claudeVersionWarning(PLUGIN_ROOT, null), /could not run `claude --version`/);
  assert.ok(compareVersions('2.1.40', '2.1.323') < 0);
  assert.ok(compareVersions('2.10.0', '2.9.9') > 0);
});

test('the default branch is the remote HEAD, else the only branch; --default-branch overrides both', (t) => {
  const origin = tempRepo(t, 'origin');
  git(origin, 'branch', '-m', 'trunk');
  const clone = path.join(path.dirname(origin), 'clone');
  execFileSync('git', ['clone', '-q', origin, clone]);
  git(clone, 'checkout', '-q', '-b', 'chore/adopt-slipway');
  quiet(clone, { check: 'x' });
  assert.equal(loadConfig(clone).defaultBranch, 'trunk');

  const solo = tempRepo(t, 'solo');
  git(solo, 'branch', '-m', 'develop');
  quiet(solo, { check: 'x' });
  assert.equal(loadConfig(solo).defaultBranch, 'develop');

  const two = tempRepo(t, 'two');
  git(two, 'checkout', '-q', '-b', 'feature');
  quiet(two, { check: 'x' });
  assert.equal(loadConfig(two).defaultBranch, 'main', 'two branches and no remote: the template default');

  const named = tempRepo(t, 'named');
  quiet(named, { check: 'x', defaultBranch: 'release' });
  assert.equal(loadConfig(named).defaultBranch, 'release');
});

test('options given beside an existing config are reported as ignored', (t) => {
  const repo = tempRepo(t);
  quiet(repo, { check: 'x' });
  const { warnings } = quiet(repo, { forge: 'none', records: 'doc/decisions' });
  assert.deepEqual(warnings, ['slipway.config.json exists, so --forge, --records changed nothing; edit the file instead']);
});

test('broken settings stop init before it writes anything', (t) => {
  const repo = tempRepo(t);
  mkdirSync(path.join(repo, '.claude'));
  writeFileSync(path.join(repo, '.claude/settings.json'), '{ "a": 1, }');
  assert.throws(() => quiet(repo, { check: 'x' }), /\.claude\/settings\.json is not valid JSON/);
  assert.deepEqual(tree(repo), ['.claude/settings.json']);
  writeFileSync(path.join(repo, '.claude/settings.json'), '{ "enabledPlugins": [] }');
  assert.throws(() => quiet(repo, { check: 'x' }), /enabledPlugins must be an object/);
});

test('adopted records are listed in the records index', (t) => {
  const repo = tempRepo(t);
  mkdirSync(path.join(repo, 'docs/adr'), { recursive: true });
  writeFileSync(path.join(repo, 'docs/adr/0002-queue.md'), '# 2. Use a queue\n\n* Status: Accepted\n');
  writeFileSync(path.join(repo, 'docs/adr/0001-db.md'), 'No heading here.\n');
  quiet(repo, { check: 'x', brownfield: true });
  const index = read(repo, 'docs/adr/README.md');
  assert.ok(
    index.endsWith(
      '| [0001](0001-db.md) | 0001-db.md | unknown |\n| [0002](0002-queue.md) | Use a queue | accepted |\n| [0003](0003-the-process.md) | The process | proposed |\n',
    ),
    index,
  );
});

test('a repository that is itself a plugin gets .claude/CLAUDE.md, which strict validation does not warn of', (t) => {
  const repo = tempRepo(t);
  mkdirSync(path.join(repo, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(repo, '.claude-plugin/plugin.json'), '{ "name": "p", "version": "0.1.0" }\n');
  assert.equal(slipway(repo, ['init', '--check', 'node --test']).code, 0);
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false);
  assert.match(read(repo, '.claude/CLAUDE.md'), /^<!-- slipway -->/);
  assert.ok(Object.hasOwn(JSON.parse(read(repo, 'slipway.budget.json')), '.claude/CLAUDE.md'));
});

test('an existing .claude/CLAUDE.md or lower-case readme gains the lines instead of a second file', (t) => {
  const repo = tempRepo(t);
  mkdirSync(path.join(repo, '.claude'));
  writeFileSync(path.join(repo, '.claude/CLAUDE.md'), '# Rules\n');
  writeFileSync(path.join(repo, 'readme.md'), '');
  quiet(repo, { check: 'x' });
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false);
  assert.match(read(repo, '.claude/CLAUDE.md'), /^# Rules\n\n<!-- slipway -->/);
  assert.deepEqual(readdirSync(repo).filter((f) => /^readme/i.test(f)), ['readme.md']);
  assert.ok(read(repo, 'readme.md').startsWith('## Setup\n'), 'an empty file is treated as new');
});

test('a new corpus starts with the process record, accepted; an adopted one gains it proposed (§5.1, §13.5)', (t) => {
  const fresh = tempRepo(t, 'fresh');
  quiet(fresh, { check: 'x', date: '2026-11-27' });
  const rec = read(fresh, 'docs/adr/0001-the-process.md');
  assert.match(rec, /^# 0001\. The process\n\n- Status: accepted\n- Date: 2026-11-27\n- Supersedes: none\n/);
  assert.match(rec, /in `docs\/plan\/D<n>\.decisions\.md`/, 'the docs paths are filled in');
  assert.ok(!rec.includes('{{'), 'no placeholder is left');
  assert.match(read(fresh, 'docs/adr/README.md'), /^\| \[0001\]\(0001-the-process\.md\) \| The process \| accepted \|$/m);

  const old = tempRepo(t, 'old');
  mkdirSync(path.join(old, 'docs/adr'), { recursive: true });
  writeFileSync(path.join(old, 'docs/adr/0041-process.md'), '# ADR-0041: Process\n\n- Status: accepted\n');
  writeFileSync(path.join(old, 'docs/adr/README.md'), '# ADRs\n\n| ADR | Title |\n| --- | --- |\n| [0041](0041-process.md) | Process |\n');
  quiet(old, { check: 'x', brownfield: true });
  assert.match(read(old, 'docs/adr/0042-the-process.md'), /^- Status: proposed$/m);
  const index = read(old, 'docs/adr/README.md');
  assert.ok(index.startsWith('# ADRs\n\n| ADR | Title |\n| --- | --- |\n| [0041](0041-process.md) | Process |\n\n'), 'the repository’s own index stays');
  assert.match(index, /\| Record \| Title \| Status \|\n\| --- \| --- \| --- \|\n\| \[0041\]\(0041-process\.md\) \| ADR-0041: Process \| accepted \|\n\| \[0042\]\(0042-the-process\.md\) \| The process \| proposed \|\n$/);
  const again = quiet(old, { brownfield: true });
  assert.ok(again.actions.every((a) => a.action === 'kept'), JSON.stringify(again.actions));
});

test('without --brownfield, a corpus of the repository’s own is left untouched', (t) => {
  const repo = tempRepo(t);
  mkdirSync(path.join(repo, 'docs/adr'), { recursive: true });
  writeFileSync(path.join(repo, 'docs/adr/0001-x.md'), '# X\n');
  quiet(repo, { check: 'x' });
  assert.deepEqual(readdirSync(path.join(repo, 'docs/adr')), ['0001-x.md']);
});

test('the budget file sets the default ceilings, never below a file’s size today (§7, §12)', (t) => {
  const repo = tempRepo(t);
  writeFileSync(path.join(repo, 'CLAUDE.md'), `# Big\n\n${'x'.repeat(6000)}\n`);
  quiet(repo, { check: 'x' });
  const budget = JSON.parse(read(repo, 'slipway.budget.json'));
  assert.equal(budget['CLAUDE.md'], readFileSync(path.join(repo, 'CLAUDE.md')).length);
  assert.equal(budget['docs/plan/README.md'], 8192);
  assert.equal(budget['docs/rules/general.md'], 12288);
  assert.equal(budget['docs/plan/D*.decisions.md'], 4096);
  const nested = tempRepo(t, 'nested');
  mkdirSync(path.join(nested, '.claude'));
  writeFileSync(path.join(nested, '.claude/CLAUDE.md'), '# Rules\n');
  quiet(nested, { check: 'x' });
  assert.ok(Object.hasOwn(JSON.parse(read(nested, 'slipway.budget.json')), '.claude/CLAUDE.md'));
});

test('--brownfield splits a ledger in another shape into the three files (§13.5 step 5)', (t) => {
  const repo = tempRepo(t);
  mkdirSync(path.join(repo, 'docs/plan'), { recursive: true });
  const old = [
    '# Delivery plan',
    '',
    'Tag prefix: `shop`',
    '',
    '| # | Deliverable | Status | Scope |',
    '| --- | --- | --- | --- |',
    '| [D1](0001-skeleton.md) | Walking skeleton | shipped 2026-10-01 | the app boots |',
    '| [D2](0002-auth.md) | Auth | in progress | sign in |',
    '| D3 | Billing \\| invoices | planned (after D2 is done) | invoices |',
    '| D4 | Search | someday | maybe |',
    '',
    '## Build plan',
    '',
    'Billing waits for auth.',
    '',
  ].join('\n');
  writeFileSync(path.join(repo, 'docs/plan/README.md'), old);
  const plain = quiet(repo, { check: 'x' });
  assert.match(plain.warnings.join('\n'), /ledger in another shape; run init --brownfield/);
  assert.equal(read(repo, 'docs/plan/README.md'), old, 'left alone without --brownfield');
  assert.equal(existsSync(path.join(repo, 'docs/plan/ROADMAP.md')), false, 'nothing is written beside it, so the split can follow');

  const brown = quiet(repo, { brownfield: true });
  assert.ok(brown.actions.some((a) => a.action === 'split' && a.path === 'docs/plan/README.md'), JSON.stringify(brown.actions));
  assert.match(brown.warnings.join('\n'), /kept as planned, status not read: D4: "someday"/);
  const ledger = read(repo, 'docs/plan/README.md');
  assert.match(ledger, /\| D \| Title \| Status \|\n\| --- \| --- \| --- \|\n\| \[D2\]\(0002-auth\.md\) \| Auth \| in progress \|\n\| D3 \| Billing \\\| invoices \| planned \|\n\| D4 \| Search \| planned \|\n$/);
  assert.match(read(repo, 'docs/plan/SHIPPED.md'), /\| \[D1\]\(0001-skeleton\.md\) \| Walking skeleton \| 2026-10-01 \|  \|\n$/);
  const roadmap = read(repo, 'docs/plan/ROADMAP.md');
  assert.match(roadmap, /## From the previous ledger\n\nTag prefix: `shop`\n\n## Build plan\n\nBilling waits for auth\.\n$/);
  assert.ok(quiet(repo, { brownfield: true }).actions.every((a) => a.action === 'kept'), 'a split ledger is Slipway’s');
});

test('an index of the repository’s own, with no records yet, is kept without --brownfield', (t) => {
  const repo = tempRepo(t);
  mkdirSync(path.join(repo, 'docs/adr'), { recursive: true });
  writeFileSync(path.join(repo, 'docs/adr/README.md'), '# Our decisions\n');
  const { warnings } = quiet(repo, { check: 'x' });
  assert.equal(read(repo, 'docs/adr/README.md'), '# Our decisions\n');
  assert.deepEqual(readdirSync(path.join(repo, 'docs/adr')), ['README.md']);
  assert.match(warnings.join('\n'), /index of the repository's own; run init --brownfield/);
});
