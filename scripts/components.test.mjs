// The skills and agents: frontmatter the design fixes, byte ceilings (§4.1) and stack-neutral text (§3.3, §11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './testing.mjs';

const SKILLS = ['plan', 'scope', 'build', 'ship', 'adr', 'init'];
// Each file's size measured at v0.2, rounded up to the next 512 bytes (docs/measurements.md). A file that must grow
// past its ceiling raises it here, in the same diff, on purpose.
const CEILINGS = {
  'skills/plan/SKILL.md': 3072,
  'skills/scope/SKILL.md': 6144,
  'skills/build/SKILL.md': 5632,
  'skills/ship/SKILL.md': 6144,
  'skills/adr/SKILL.md': 4608,
  'skills/init/SKILL.md': 5120,
  'agents/step-builder.md': 4096,
  'agents/code-reviewer.md': 2560,
  'agents/adr-reviewer.md': 2560,
  'agents/security-reviewer.md': 2560,
  'agents/gate-runner.md': 2048,
  'agents/adr-author.md': 1536,
};

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
    const ceiling = CEILINGS[f];
    assert.ok(ceiling, `${f} has no ceiling; give it one in CEILINGS`);
    assert.ok(size <= ceiling, `${f} is ${size} bytes, over its ceiling of ${ceiling}`);
  }
});

/** The code in a markdown text, past its frontmatter: each inline span and each line of a fenced block, with its line. */
export function codeSpans(text) {
  const lines = text.split('\n');
  const fm = /^---\n[\s\S]*?\n---\n/.exec(text);
  const out = [];
  let fenced = false;
  for (let i = fm ? fm[0].split('\n').length - 1 : 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (fenced) {
      if (line.trim()) out.push({ line: i + 1, code: line.trim(), fenced: true });
    } else for (const m of line.matchAll(/(`+)(.+?)\1/g)) out.push({ line: i + 1, code: m[2].trim(), fenced: false });
  }
  return out;
}

// The first words that make a span a command, read past any opening group, negation, substitution or assignment.
const COMMAND_WORDS = new Set(
  ('slipway git gh node claude cd echo printf sed awk grep rg cat head tail wc ls find xargs rm mv cp mkdir touch tee ' +
    'until while for if sleep test date bash sh cmd pwsh powershell export curl make npm pnpm yarn npx').split(' '),
);
const isCommand = (code) =>
  COMMAND_WORDS.has(code.replace(/^(\s*(\(|\{\s|!\s|\$\(|\[\[\s|[A-Za-z_]\w*=\S*\s))*\s*/, '').split(/\s+/)[0]);

/** What makes a command more than one plain command, each named; `${CLAUDE_PLUGIN_ROOT}` and `$ARGUMENTS` are allowed. */
export function shellProblems(code, { fenced = false } = {}) {
  // A placeholder, `<word>` or `<a few words>`, is not a redirect; `<a|b>` inside one is not a pipe.
  const text = code.replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$ARGUMENTS\b/g, '').replace(/<[^\s<>](?:[^<>]*[^\s<>])?>/g, 'X');
  let expanding = ''; // outside single quotes: where `$` still expands
  let bare = ''; // outside any quotes: where operators still act
  let quote = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"') expanding += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else {
      expanding += ch;
      bare += ch;
    }
  }
  const problems = [];
  if (/\$\(/.test(expanding) || (fenced && /`/.test(expanding))) problems.push('command substitution');
  if (/\$(\{|[A-Za-z_]|\d|[@*#?!$-])/.test(expanding)) problems.push('parameter expansion');
  if (!isCommand(code)) return problems;
  const ops = [
    [/&&/, '&&'],
    [/\|\|/, '||'],
    [/(^|[^|])\|(?!\|)/, 'a pipe'],
    [/;/, ';'],
    [/[<>]/, 'a redirect'],
    [/(^|[^&])&(?!&)/, 'a background &'],
    [/(^|\s)!(\s|$)/, '! negation'],
    [/[(){}]/, 'grouping', bare.replace(/\$\([^()]*\)|\$\{[^{}]*\}/g, '')],
    [/(^|\s)sed\s+(-\w*\s+)*-i/, 'sed -i'],
  ];
  for (const [re, name, against = bare] of ops) if (re.test(against)) problems.push(name);
  return problems;
}

test('shellProblems names what makes a command more than one plain command (D2)', () => {
  const cases = [
    ['slipway tag D2 --commit $(git rev-parse origin/main)', ['command substitution']],
    ['git push -u origin ${BRANCH}', ['parameter expansion']],
    ['slipway forge comments | grep reviewed', ['a pipe']],
    ['cd x && slipway run check', ['&&']],
    ['slipway run gate || true', ['||']],
    ['git fetch; git merge origin/main', [';']],
    ['echo done > out.txt', ['a redirect']],
    ['! git diff --quiet', ['! negation']],
    ['(cd x && git status)', ['&&', 'grouping']],
    ["sed -i 's/a/b/' file", ['sed -i']],
    ['until grep -q PASS log; do sleep 5; done', [';']],
  ];
  for (const [code, want] of cases) assert.deepEqual(shellProblems(code), want, code);
  for (const code of [
    'slipway lane --step <k>',
    'git -C <main checkout> pull --ff-only',
    'slipway init --forge <github|none> --check "<a && b>"',
    'slipway forge pr-open --title "D<n> — <title>" --body-file <a file naming the plan\'s path and its CI: value>',
    'node -p "process.platform+\' \'+process.arch"',
    'slipway release bump <part>',
    'fix(<scope>): D<n>.<k> review findings',
    'RESULT: PASS | FAIL | BLOCKED',
    '${CLAUDE_PLUGIN_ROOT}/templates/plan.md',
    'git rev-parse origin/<default>',
    '(with: <parent>)',
    'slipway tag D2 --title "argument-hint: [D<n> | D<n>.<k>]"',
  ])assert.deepEqual(shellProblems(code), [], code);
  assert.deepEqual(shellProblems('slipway digest `date`', { fenced: true }), ['command substitution']);
});

test('skill, agent and template code spans are plain commands (D2)', () => {
  const files = [
    ...skillDirs().map((d) => `skills/${d}/SKILL.md`),
    ...agentFiles().map((f) => `agents/${f}`),
    'templates/plan.md',
  ].filter((f) => existsSync(path.join(PLUGIN_ROOT, f)));
  const failures = [];
  for (const f of files) {
    for (const { line, code, fenced } of codeSpans(readFileSync(path.join(PLUGIN_ROOT, f), 'utf8'))) {
      const problems = shellProblems(code, { fenced });
      if (problems.length) failures.push(`${f}:${line} \`${code}\` — ${problems.join(', ')}`);
    }
  }
  assert.deepEqual(failures, [], `not one plain command per call:\n${failures.join('\n')}`);
});

test('each agent that runs commands says one plain command per Bash call, and writes with Write (D2)', () => {
  for (const f of agentFiles()) {
    const text = readFileSync(path.join(PLUGIN_ROOT, 'agents', f), 'utf8');
    const tools = (frontmatter(text)?.tools ?? '').split(/,\s*/);
    if (!tools.includes('Bash')) continue;
    assert.match(text, /one plain command per Bash call/i,`agents/${f} runs commands but does not say one plain command per Bash call`);
    if (tools.includes('Grep')) assert.match(text, /search with Grep/i, `agents/${f} does not say to search with Grep`);
    else assert.doesNotMatch(text, /with Grep/i, `agents/${f} has no Grep tool but is told to use it`);
    assert.match(text, /never sed -i/, `agents/${f} does not forbid sed -i`);
    if (tools.includes('Write')) assert.match(text, /Write files with Write, change them with Edit/, `agents/${f} does not say to write with Write and change with Edit`);
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
