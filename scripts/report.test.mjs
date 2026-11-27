import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { body, imports, rulePaths } from './report.mjs';
import { PLUGIN_ROOT, git, slipway, tempRepo } from './testing.mjs';

const PLAN = readFileSync(new URL('./fixtures/plan.md', import.meta.url), 'utf8');
const read = (repo, p) => readFileSync(path.join(repo, p), 'utf8');
const write = (repo, p, text) => {
  mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
  writeFileSync(path.join(repo, p), text);
};
const size = (repo, p) => Buffer.byteLength(read(repo, p));
const agentBody = Buffer.byteLength(body(readFileSync(path.join(PLUGIN_ROOT, 'agents', 'step-builder.md'), 'utf8')));

/** A repository from init with an `api` area and its conventions skill, on lane D4 (step 2 touches src/api/**). */
function lane(t) {
  const repo = tempRepo(t);
  assert.equal(slipway(repo, ['init', '--check', 'x']).code, 0);
  const cfg = JSON.parse(read(repo, 'slipway.config.json'));
  cfg.areas = { api: { paths: ['src/api/**'], skills: ['api-conventions'] }, web: { paths: ['web/app/**'] } };
  write(repo, 'slipway.config.json', JSON.stringify(cfg, null, 2));
  write(repo, 'docs/adr/0002-money.md', '# 0002. Money\n\n- Status: accepted\n\n## Rules\n\n- **Money.** Store cents as integers. (areas: api)\n');
  assert.equal(slipway(repo, ['digest']).code, 0);
  write(repo, '.claude/skills/api-conventions/SKILL.md', '---\nname: api-conventions\ndescription: x\n---\n\n# API\n\nHandlers are thin.\n');
  write(repo, 'docs/plan/D4.md', PLAN.replace('## Done when', `## Constraints\n\n${CONSTRAINT}\n\n## Done when`));
  git(repo, 'checkout', '-q', '-b', 'lane/D4');
  return repo;
}
const CONSTRAINT = '- No ceiling rises in this lane.';

test('the helpers read rule frontmatter, imports and bodies as Claude Code does', () => {
  assert.deepEqual(rulePaths('---\npaths:\n  - "src/**"\n  - \'lib/*.js\'\n---\n\nx'), ['src/**', 'lib/*.js']);
  assert.deepEqual(rulePaths('---\npaths: ["a/**", b/**]\n---\nx'), ['a/**', 'b/**']);
  assert.deepEqual(rulePaths('---\npaths: ["src/{api,db}/**", "x,y.md"]\n---\nx'), ['src/{api,db}/**', 'x,y.md']);
  assert.equal(rulePaths('no frontmatter'), null);
  assert.equal(rulePaths('---\ndescription: x\n---\n'), null);
  assert.deepEqual(imports('See @a.md and @../b.md.\n`@not` this\n```\n@nor-this\n```\n@c/d.md'), ['a.md', '../b.md.', 'c/d.md']);
  assert.equal(body('---\nname: x\n---\n\nText\n'), 'Text\n');
});

test('`slipway report` prints a step’s fixed load by part, and the area rules only for its paths (§7)', (t) => {
  const repo = lane(t);
  const r = slipway(repo, ['report']);
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /^D4\.2 The refund endpoint — a step builder's fixed load \(§7\)$/m, 'the next unbuilt step');
  const briefText = slipway(repo, ['lane', '--step', '2']).stdout;
  assert.ok(briefText.includes(`## Constraints\n\n${CONSTRAINT}\n`), 'the brief counted carries the plan\'s constraints');
  const brief = Buffer.byteLength(briefText);
  const loader = size(repo, '.claude/rules/slipway-api.md') - '---\npaths:\n  - "src/api/**"\n---\n\n'.length;
  const always = size(repo, 'CLAUDE.md') + size(repo, '.claude/rules/slipway.md') + size(repo, 'docs/rules/general.md');
  const skill = Buffer.byteLength('# API\n\nHandlers are thin.\n');
  assert.match(out, new RegExp(`^always on +${always.toLocaleString('en-US')}$`, 'm'));
  assert.match(out, new RegExp(`^ +${agentBody.toLocaleString('en-US')}  step-builder \\(agent body\\)$`, 'm'));
  assert.match(out, new RegExp(`^ +${brief.toLocaleString('en-US')}  slipway lane --step 2$`, 'm'));
  assert.match(out, new RegExp(`^ +${loader.toLocaleString('en-US')}  \\.claude/rules/slipway-api\\.md$`, 'm'));
  assert.doesNotMatch(out, /slipway-web\.md/, 'an area the step does not reach');
  assert.match(out, /^ +\d+  \.claude\/skills\/api-conventions\/SKILL\.md$/m);
  const total = always + agentBody + brief + loader + skill;
  assert.match(out, new RegExp(`^total: ${total.toLocaleString('en-US')} bytes \\(.* KB, ≈ [\\d,]+ tokens\\), under the 40\\.0 KB target$`, 'm'));
  assert.match(out, /^not fixed load: the spec, the code$/m);
  // Step 1 names a record and reaches no area.
  const one = slipway(repo, ['report', 'D4.1']).stdout;
  assert.doesNotMatch(one, /slipway-api\.md/);
  assert.match(one, /^not fixed load: the records it names \(0003-money\.md\), the spec, the code$/m);
  assert.equal(slipway(repo, ['report', '--step', '1']).stdout, one);
  // A CLAUDE.md on the way to the step's paths loads on the first read there; an import ending a sentence counts.
  write(repo, 'src/CLAUDE.md', 'Source notes; see @notes.md.\n');
  write(repo, 'src/notes.md', 'n\n');
  write(repo, 'lib/CLAUDE.md', 'not on the way\n');
  const two = slipway(repo, ['report', 'D4.2']).stdout;
  assert.match(two, /^ +29  src\/CLAUDE\.md$/m);
  assert.match(two, /^ +2  src\/notes\.md$/m);
  assert.doesNotMatch(two, /lib\/CLAUDE\.md/);
});

test('an @ import in a path-scoped rule counts as always on, a missing skill is named, and --check gates 40 KB', (t) => {
  const repo = lane(t);
  // A loader as v0.1 wrote it: Claude Code reads the import at session start, whatever the paths.
  write(repo, '.claude/rules/slipway-web.md', '---\npaths:\n  - "web/app/**"\n---\n\n@../../docs/rules/web.md\n');
  write(repo, 'docs/rules/web.md', `# Rules: web\n\n${'- **Big.** rule.\n'.repeat(3000)}`);
  const cfg = JSON.parse(read(repo, 'slipway.config.json'));
  cfg.areas.api.skills.push('plugin:elsewhere');
  write(repo, 'slipway.config.json', JSON.stringify(cfg, null, 2));
  const r = slipway(repo, ['report', 'D4.1']);
  assert.equal(r.code, 0, 'over the target is reported, not failed, without --check');
  assert.match(r.stdout, /^ +[\d,]+  docs\/rules\/web\.md$/m);
  assert.match(r.stdout, /OVER the 40\.0 KB target$/m);
  assert.equal(slipway(repo, ['report', 'D4.1', '--check']).code, 1);
  assert.match(slipway(repo, ['report', 'D4.2']).stdout, /^not found in \.claude\/skills, not counted: plugin:elsewhere$/m);
  assert.equal(slipway(repo, ['report', 'D4.9']).code, 2);
  write(repo, 'docs/plan/D4.md', PLAN.replace('- [ ] Built', '- [x] Built'));
  assert.match(slipway(repo, ['report']).stderr, /every step of D4 is built; name one as D4\.<k>/);
});
