// The skills and agents: frontmatter the design fixes, byte ceilings (§4.1) and stack-neutral text (§3.3, §11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './testing.mjs';

const SKILLS = ['plan', 'scope', 'build', 'ship', 'adr', 'init'];
const CEILINGS = { 'skills/scope/SKILL.md': 6144, 'skills/build/SKILL.md': 6144, 'skills/ship/SKILL.md': 6144, 'agents/step-builder.md': 4096 };
const DEFAULT_CEILING = 6144;

/** The frontmatter's top-level scalar keys; lists and nested values are kept as their raw text. */
export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const out = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].replace(/^"(.*)"$/, '$1');
    } else if (key) out[key] += `\n${line}`;
  }
  return out;
}

const skillDirs = () => (existsSync(path.join(PLUGIN_ROOT, 'skills')) ? readdirSync(path.join(PLUGIN_ROOT, 'skills')) : []);
const agentFiles = () => (existsSync(path.join(PLUGIN_ROOT, 'agents')) ? readdirSync(path.join(PLUGIN_ROOT, 'agents')).filter((f) => f.endsWith('.md')) : []);

test('each skill is one of the six, named for its folder, typed by the operator only (§3.2, §4.1)', () => {
  for (const dir of skillDirs()) {
    assert.ok(SKILLS.includes(dir), `skills/${dir} is not one of ${SKILLS.join(', ')}`);
    const fm = frontmatter(readFileSync(path.join(PLUGIN_ROOT, 'skills', dir, 'SKILL.md'), 'utf8'));
    assert.ok(fm, `skills/${dir}/SKILL.md has no frontmatter`);
    assert.equal(fm.name, dir);
    assert.ok(fm.description?.length > 20, `skills/${dir} needs a description`);
    assert.equal(fm['disable-model-invocation'], 'true', `skills/${dir} must set disable-model-invocation: true`);
  }
});

test('skills and agents stay under their byte ceilings (§4.1)', () => {
  const files = [...skillDirs().map((d) => `skills/${d}/SKILL.md`), ...agentFiles().map((f) => `agents/${f}`)];
  for (const f of files) {
    const size = statSync(path.join(PLUGIN_ROOT, f)).size;
    const ceiling = CEILINGS[f] ?? DEFAULT_CEILING;
    assert.ok(size <= ceiling, `${f} is ${size} bytes, over its ceiling of ${ceiling}`);
  }
});

test('no skill, agent or template names a build tool or runs `sh -c` (§3.3, §11)', () => {
  const dirs = ['skills', 'agents', 'templates', 'hooks'].map((d) => path.join(PLUGIN_ROOT, d)).filter(existsSync);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of dirs.flatMap(walk)) {
    const text = readFileSync(file, 'utf8');
    for (const word of [/\bpnpm\b/, /\bnpm (run|test|exec)\b/, /\bnpx\b/, /\byarn\b/, /\bcargo (test|build)\b/, /\bsh -c\b/]) {
      assert.doesNotMatch(text, word, `${path.relative(PLUGIN_ROOT, file)} names ${word}`);
    }
  }
});
