// The plugin manifest and the marketplace entry carry one version (§13.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const plugin = read('.claude-plugin/plugin.json');
const market = read('.claude-plugin/marketplace.json');

test('plugin and marketplace are both named slipway', () => {
  assert.equal(plugin.name, 'slipway');
  assert.equal(market.name, 'slipway');
  assert.deepEqual(market.plugins.map((p) => p.name), ['slipway']);
});

test('the marketplace entry points at the repository root', () => {
  assert.equal(market.plugins[0].source, './');
});

test('plugin.json and the marketplace entry carry the same version', () => {
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(market.plugins[0].version, plugin.version);
});
