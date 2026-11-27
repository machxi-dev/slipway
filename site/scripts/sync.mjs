// Writes the site's generated pages from the repository's own files, so the site never holds a second copy
// of what the README, the design, the skills, the process record and the changelog say. Run before every
// dev or build (package.json does). Dependency-free, like the plugin. The pages it writes are gitignored.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('..', import.meta.url));
const repo = path.resolve(site, '..');
const out = path.join(site, 'src');

const read = (p) => readFileSync(path.join(repo, p), 'utf8').replace(/\r\n/g, '\n');
const json = (p) => JSON.parse(read(p));
const plugin = json('.claude-plugin/plugin.json');
const GITHUB = plugin.repository.replace(/\/$/, '');

const skills = readdirSync(path.join(repo, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(repo, 'skills', d.name, 'SKILL.md')))
  .map((d) => d.name);
// The order a reader meets them in: the loop, then the two helpers.
const ORDER = ['plan', 'scope', 'build', 'ship', 'adr', 'init'];
skills.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));

/** Repository file → site route. Every other relative link goes to the file on GitHub. */
const ROUTES = {
  'README.md': '/',
  'docs/design.md': '/reference/design',
  'docs/measurements.md': '/reference/measurements',
  'CHANGELOG.md': '/reference/changelog',
  'templates/process-record.md': '/guide/method',
  'docs/adr/0001-the-process.md': '/guide/method',
  ...Object.fromEntries(skills.map((s) => [`skills/${s}/SKILL.md`, `/commands/${s}`])),
};

const problems = [];

// ---------------------------------------------------------------------------------------------------------
// Markdown rewriting: relative links, design section references, and what Vue would read as template.

const FENCE = /^\s*(`{3,}|~{3,})/;

/** The design's section ids, from its numbered headings: "## 4. The process" → s4, "### 4.5 …" → s4-5. */
const sectionId = (num) => `s${num.replace(/\.$/, '').replaceAll('.', '-')}`;
const designSections = new Set();
for (const line of read('docs/design.md').split('\n')) {
  const m = /^#{2,3} (\d+(?:\.\d+)?)\.? /.exec(line);
  if (m) designSections.add(sectionId(m[1]));
}

function linkTarget(target, from) {
  if (/^(?:[a-z]+:|#|\/)/i.test(target)) return target;
  const [file, hash] = target.split('#');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), file));
  if (resolved.startsWith('..')) {
    problems.push(`${from}: link "${target}" leaves the repository`);
    return target;
  }
  const route = ROUTES[resolved];
  const base = route ?? `${GITHUB}/blob/main/${resolved}`;
  return hash ? `${base}#${hash}` : base;
}

/** Rewrite prose outside code: links, § references, and characters Vue or HTML would swallow. */
function rewriteText(text, from, designHref) {
  text = text.replace(/\]\(([^)\s]+)\)/g, (_, t) => `](${linkTarget(t, from)})`);
  text = text.replace(/(?<!\[)§(\d+(?:\.\d+)?)/g, (whole, num) => {
    const id = sectionId(num);
    if (!designSections.has(id)) {
      problems.push(`${from}: ${whole} names no section of docs/design.md`);
      return whole;
    }
    return `[${whole}](${designHref}#${id})`;
  });
  // A bare "<n>" or "{{" in prose is text, not a tag or an interpolation.
  text = text.replace(/<(?!!--|\/?(?:a|br|img|kbd|sub|sup|details|summary)\b)/g, '&lt;');
  text = text.replace(/\{\{/g, '&#123;&#123;');
  return text;
}

function rewriteLine(line, from, designHref) {
  // Split on code spans; only the text between them is rewritten.
  const parts = line.split(/(`+[^`]*?`+)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        if (part.includes('{{')) problems.push(`${from}: a code span holds "{{", which Vue would interpolate`);
        return part;
      }
      return rewriteText(part, from, designHref);
    })
    .join('');
}

function rewrite(markdown, from, { designHref = '/reference/design', anchors = false } = {}) {
  let fence = null;
  return markdown
    .split('\n')
    .map((line) => {
      const f = FENCE.exec(line);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
        return line;
      }
      if (f) {
        fence = f[1];
        return line;
      }
      if (anchors) {
        const m = /^(#{2,3}) (\d+(?:\.\d+)?)\.? /.exec(line);
        if (m) return `${rewriteLine(line, from, designHref)} {#${sectionId(m[2])}}`;
      }
      return rewriteLine(line, from, designHref);
    })
    .join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// Small readers.

/** "## Heading" → its body, for a file's second-level sections; "" holds the text before the first. */
function sections(markdown) {
  const map = new Map([['', []]]);
  let current = '';
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) fence = !fence;
    const m = !fence && /^## (.+)$/.exec(line);
    if (m) {
      current = m[1].trim();
      map.set(current, []);
    } else map.get(current).push(line);
  }
  return new Map([...map].map(([k, v]) => [k, v.join('\n').trim()]));
}

function need(map, key, file) {
  if (!map.has(key)) {
    problems.push(`${file}: no "## ${key}" section`);
    return '';
  }
  return map.get(key);
}

function frontmatter(markdown) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!m) return { data: {}, body: markdown };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return { data, body: markdown.slice(m[0].length) };
}

const dropH1 = (body) => body.replace(/^\s*# .*\n+/, '');
const yaml = (v) => JSON.stringify(v); // JSON is YAML, and quotes what YAML would misread.

function page(file, meta, body, source) {
  const head = Object.entries({ ...meta, ...(source ? { source } : {}) })
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? yaml(v) : v}`)
    .join('\n');
  const note = source ? `<!-- Generated by site/scripts/sync.mjs from ${source}; edit that file, not this one. -->\n\n` : '';
  const target = path.join(out, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `---\n${head}\n---\n\n${note}${body.trim()}\n`);
  written.push(file);
}
const written = [];

// ---------------------------------------------------------------------------------------------------------
// The pages.

const readme = read('README.md');
const readmeSections = sections(readme);
const intro = readmeSections.get('');

// Home: the hero from plugin.json's description, the features from the README's bold bullets.
{
  const [text, tagline] = plugin.description.split(/:\s+/, 2);
  const features = [...intro.matchAll(/^- \*\*(.+?)\*\*\s*(.+)$/gm)].map(([, title, details]) => ({
    title: title.replace(/\.$/, ''),
    details,
  }));
  if (features.length === 0) problems.push('README.md: no "- **Title.** text" bullets for the home page features');
  const lead = intro
    .split(/\n\n+/)
    .filter((p) => !p.startsWith('# ') && !p.startsWith('- ') && !p.startsWith('>') && !p.startsWith('Slipway is') && !p.includes('github.io/slipway'))
    .join('\n\n');
  const commands = need(readmeSections, 'Commands', 'README.md').replace(/^\| `\/slipway:(\w+)` \|/gm, (whole, name) =>
    skills.includes(name) ? `| [\`/slipway:${name}\`](/commands/${name}) |` : whole,
  );
  const install = need(readmeSections, 'Install', 'README.md').match(/```sh\n[\s\S]*?```/)?.[0] ?? '';

  const hero = [
    'hero:',
    `  name: Slipway`,
    `  text: ${yaml(text)}`,
    `  tagline: ${yaml(tagline.charAt(0).toUpperCase() + tagline.slice(1))}`,
    '  image:',
    '    src: /logo.svg',
    '    alt: Slipway',
    '  actions:',
    '    - theme: brand',
    '      text: Get started',
    '      link: /guide/getting-started',
    '    - theme: alt',
    '      text: The method',
    '      link: /guide/method',
    '    - theme: alt',
    '      text: GitHub',
    `      link: ${GITHUB}`,
    'features:',
    ...features.flatMap((f) => [`  - title: ${yaml(f.title)}`, `    details: ${yaml(f.details)}`]),
  ].join('\n');
  const target = path.join(out, 'index.md');
  mkdirSync(out, { recursive: true });
  writeFileSync(
    target,
    `---\nlayout: home\ntitle: Slipway\ntitleTemplate: ${yaml(text)}\nsource: README.md\n${hero}\n---\n\n` +
      `<!-- Generated by site/scripts/sync.mjs from README.md and .claude-plugin/plugin.json. -->\n\n` +
      `<div class="home-body">\n\n` +
      `${rewrite(lead, 'README.md')}\n\n## Six commands\n\n${rewrite(commands, 'README.md')}\n\n` +
      `## Install\n\nIn the repository you want to use it in:\n\n${install}\n\n` +
      `Then, in Claude Code, run \`/slipway:init\`. [Getting started](/guide/getting-started) has the requirements and what each clone does.\n\n</div>\n`,
  );
  written.push('index.md');
}

// Getting started: the README's status, requirements and install.
{
  const status = intro
    .split(/\n\n+/)
    .filter((p) => p.startsWith('>'))
    .map((p) => p.replace(/^> ?/gm, ''))
    .join('\n\n');
  const body = [
    '# Getting started',
    status ? `::: warning\n${status}\n:::` : '',
    '## Requirements',
    need(readmeSections, 'Requirements', 'README.md'),
    '## Install',
    need(readmeSections, 'Install', 'README.md'),
    '## Next',
    '- [Configuration](/guide/configuration): the commands and paths `/slipway:init` writes into `slipway.config.json`.',
    '- [Commands](/commands/): what each of the six commands does.',
    '- [The method](/guide/method): the rules the commands follow, as one record.',
  ]
    .filter(Boolean)
    .join('\n\n');
  page('guide/getting-started.md', { title: 'Getting started' }, rewrite(body, 'README.md'), 'README.md');
}

// Contributing: the README's development loop and licence.
{
  const body = [
    '# Contributing',
    need(readmeSections, 'Developing Slipway', 'README.md'),
    'The docs site is built from the same files: the README, the design, the skills, the process record and the changelog. Its own sources, and the one hand-written page, are in [`site/`](site/README.md).',
    '## License',
    need(readmeSections, 'License', 'README.md'),
  ].join('\n\n');
  page('guide/contributing.md', { title: 'Contributing' }, rewrite(body, 'README.md'), 'README.md');
}

// The method: the process record `init` writes, with the config's default folders in its placeholders.
{
  const config = json('templates/slipway.config.json');
  const values = { digests: config.docs.digests, plans: config.docs.plans, records: config.docs.records };
  let record = read('templates/process-record.md');
  record = record.replace(/^# .*\n+/, '').replace(/^- (Status|Date|Supersedes): .*\n/gm, '').trimStart();
  record = record.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (key in values) return values[key];
    problems.push(`templates/process-record.md: no value for ${whole}`);
    return whole;
  });
  const body =
    '# The method\n\n' +
    `::: info The process record\n\`/slipway:init\` writes this record into your repository as its first decision record, and \`slipway digest\` turns its \`## Rules\` into the rules every session loads. The folders shown are the defaults; yours are what \`slipway.config.json\` names. The [design](/reference/design) says why each rule is there.\n:::\n\n` +
    record;
  page('guide/method.md', { title: 'The method', outline: [2, 3] }, rewrite(body, 'templates/process-record.md'), 'templates/process-record.md');
}

// Commands: the README's table, then one page per skill from its own SKILL.md.
{
  const table = need(readmeSections, 'Commands', 'README.md').replace(/^\| `\/slipway:(\w+)` \|/gm, (whole, name) =>
    skills.includes(name) ? `| [\`/slipway:${name}\`](/commands/${name}) |` : whole,
  );
  const body =
    '# Commands\n\n' +
    table +
    '\n\nEach command is a skill the operator types; none is invoked by Claude on its own (`disable-model-invocation`), so their descriptions cost no session any context. A lane runs `plan` → `scope` → `build` → `ship`; `adr` and `init` are the helpers.\n\n' +
    'Each command\'s page is the skill as Claude reads it when you type the command.';
  page('commands/index.md', { title: 'Commands' }, rewrite(body, 'README.md'), 'README.md');

  for (const name of skills) {
    const source = `skills/${name}/SKILL.md`;
    const { data, body } = frontmatter(read(source));
    if (!data.description) problems.push(`${source}: no description in its frontmatter`);
    const usage = `/slipway:${name}${data['argument-hint'] ? ` ${data['argument-hint']}` : ''}`;
    const runs = [data.model && `model \`${data.model}\``, data.effort && `effort \`${data.effort}\``].filter(Boolean);
    const md = [
      `# /slipway:${name}`,
      data.description ?? '',
      '```text\n' + usage + '\n```',
      `::: info What Claude follows\nThe rest of this page is [the skill](${GITHUB}/blob/main/${source}) itself: the instructions Claude follows when you type the command.${runs.length ? ` It runs on ${runs.join(', ')}.` : ''}\n:::`,
      dropH1(body),
    ].join('\n\n');
    page(`commands/${name}.md`, { title: `/slipway:${name}`, description: data.description ?? '' }, rewrite(md, source), source);
  }
}

// Reference: the design (with section anchors for every § link), the measurements, the changelog.
page('reference/design.md', { title: 'Design', outline: [2, 3] }, rewrite(read('docs/design.md'), 'docs/design.md', { designHref: '', anchors: true }), 'docs/design.md');
page('reference/measurements.md', { title: 'Measurements', outline: [2, 3] }, rewrite(read('docs/measurements.md'), 'docs/measurements.md'), 'docs/measurements.md');
page('reference/changelog.md', { title: 'Changelog', outline: [2, 3] }, rewrite(read('CHANGELOG.md'), 'CHANGELOG.md'), 'CHANGELOG.md');

// ---------------------------------------------------------------------------------------------------------
// The one hand-written page names every key the config schema knows, so a new key cannot go undocumented.
{
  const schema = read('scripts/config.mjs');
  const keys = [];
  for (const m of schema.matchAll(/known\(\s*\w+\s*,\s*(?:'([^']*)'|(\w+))\s*,\s*\[([^\]]*)\]/g)) {
    const prefix = m[1] ?? (m[2] === 'where' ? 'areas.<slug>' : null);
    if (prefix === null) {
      problems.push(`scripts/config.mjs: cannot tell which section known(…, ${m[2]}, …) checks`);
      continue;
    }
    for (const k of m[3].matchAll(/'([^']+)'/g)) keys.push(prefix ? `${prefix}.${k[1]}` : k[1]);
  }
  if (keys.length < 10) problems.push('scripts/config.mjs: could not read the schema\'s keys; update site/scripts/sync.mjs');
  const doc = readFileSync(path.join(out, 'guide/configuration.md'), 'utf8');
  for (const key of keys) {
    if (!doc.includes(`\`${key}\``)) problems.push(`site/src/guide/configuration.md: the config key \`${key}\` is not documented`);
  }
}

if (problems.length) {
  console.error(`sync: ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`sync: wrote ${written.length} pages from the repository`);
