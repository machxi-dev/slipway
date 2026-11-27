import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bumpVersion, readVersion } from './release.mjs';
import { git, slipway, tempRepo } from './testing.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/config/slipway.json', import.meta.url), 'utf8'));

test('versions are read from JSON, TOML-style lines or a plain file, and bumped by part', () => {
  assert.equal(readVersion('{\n  "name": "x",\n  "version": "0.1.0"\n}'), '0.1.0');
  assert.equal(readVersion('[package]\nversion = "1.2.3"\n'), '1.2.3');
  assert.equal(readVersion('2.0.0\n'), '2.0.0');
  assert.equal(readVersion('nothing'), null);
  assert.equal(bumpVersion('0.1.9', 'patch'), '0.1.10');
  assert.equal(bumpVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(bumpVersion('0.1.9', 'major'), '1.0.0');
  assert.throws(() => bumpVersion('0.1.0', 'huge'), /patch, minor, major/);
});

test("`slipway release bump` moves the version in every file the release block names (this repository's own config)", (t) => {
  const repo = tempRepo(t);
  writeFileSync(path.join(repo, 'slipway.config.json'), JSON.stringify(FIXTURE));
  mkdirSync(path.join(repo, '.claude-plugin'));
  writeFileSync(path.join(repo, '.claude-plugin/plugin.json'), '{\n  "name": "slipway",\n  "version": "0.1.0"\n}\n');
  writeFileSync(path.join(repo, '.claude-plugin/marketplace.json'), '{ "plugins": [ { "name": "slipway", "version": "0.1.0" } ] }\n');
  const r = slipway(repo, ['release', 'bump', 'minor']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^0\.1\.0 -> 0\.2\.0; tag v0\.2\.0$/m);
  assert.equal(readFileSync(path.join(repo, '.claude-plugin/plugin.json'), 'utf8'), '{\n  "name": "slipway",\n  "version": "0.2.0"\n}\n');
  assert.match(readFileSync(path.join(repo, '.claude-plugin/marketplace.json'), 'utf8'), /"version": "0\.2\.0"/);
});

test('`slipway tag` tags the merge commit whose second parent is the lane head, and never moves a tag (§14)', (t) => {
  const repo = tempRepo(t);
  assert.equal(slipway(repo, ['init', '--check', 'x', '--tag-prefix', 'shop']).code, 0);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'checkout', '-q', '-b', 'lane/D3');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: D3.1');
  const head = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', "Merge branch 'lane/D3'", 'lane/D3');
  const merge = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'later');
  const r = slipway(repo, ['tag', 'D3', '--head', head, '--pr', 'https://x/pull/3', '--title', 'Refunds']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), `shop-D3 ${merge}`);
  assert.equal(git(repo, 'rev-parse', 'shop-D3^{commit}'), merge);
  assert.equal(git(repo, 'tag', '-l', '--format=%(contents)', 'shop-D3'), 'D3. Refunds\n\nhttps://x/pull/3');
  const again = slipway(repo, ['tag', 'D3', '--head', head]);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already exists; a tag is never moved/);
  assert.match(slipway(repo, ['tag', 'D4', '--head', 'HEAD']).stderr, /no merge commit on main has HEAD as its second parent/);
});
