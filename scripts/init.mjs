// `slipway init`: make a repository ready (docs/design.md §3.2, §4.7, §12, §13.4).
// It never overwrites: a file that exists is kept, and a shared file (settings, CLAUDE.md, README) only gains
// what is missing. Running it twice changes nothing.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CONFIG_FILE, loadConfig, normalize } from './config.mjs';
import { currentBranch } from './git.mjs';

export const render = (text, vars) =>
  text.replace(/\{\{(\w+)\}\}/g, (m, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : m));

/** Compare dotted versions: negative, zero or positive. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The installed Claude Code's version, or null when `claude` cannot be run. */
export function claudeVersion() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 30_000 });
  if (r.status !== 0) return null;
  return /(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1] ?? null;
}

/** §10: enforcement of engines is not documented, so init checks the version itself. Returns a warning or null. */
export function claudeVersionWarning(pluginRoot, installed) {
  const manifest = JSON.parse(readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  const min = /(\d+\.\d+\.\d+)/.exec(manifest.engines?.['claude-code'] ?? '')?.[1];
  if (!min) return null;
  if (installed === null) return `could not run \`claude --version\`; Slipway needs Claude Code ${min} or later`;
  if (compareVersions(installed, min) < 0) return `Claude Code ${installed} is older than ${min}, which Slipway needs; update it`;
  return null;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
const posix = (p) => p.split(path.sep).join('/');

/**
 * Initialise the repository at `root`. `options` come from the command line:
 * check, stepCheck, gate, tagPrefix, forge, records, plans, digests, specs ('none' for null), brownfield.
 * Returns { config, actions: [{ action: 'wrote' | 'kept' | 'updated' | 'adopted', path, note? }], warnings }.
 */
export function init(root, pluginRoot, options = {}, { installedClaude = claudeVersion() } = {}) {
  const template = (name) => readFileSync(path.join(pluginRoot, 'templates', name), 'utf8');
  const actions = [];
  const warnings = [];
  const rel = (p) => posix(path.relative(root, p));
  const abs = (p) => path.resolve(root, p);

  const writeNew = (file, content) => {
    if (existsSync(file)) {
      actions.push({ action: 'kept', path: rel(file) });
      return;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    actions.push({ action: 'wrote', path: rel(file) });
  };

  // The config: kept when present, otherwise made from the template and the options.
  const configFile = path.join(root, CONFIG_FILE);
  let config;
  if (existsSync(configFile)) {
    config = loadConfig(root);
    actions.push({ action: 'kept', path: CONFIG_FILE });
  } else {
    if (!options.check) {
      const e = new Error('a new config needs the command that proves the tree: --check "<command>"');
      e.code = 'EUSAGE';
      throw e;
    }
    const raw = JSON.parse(template('slipway.config.json'));
    raw.defaultBranch = currentBranch(root) ?? raw.defaultBranch;
    raw.forge = options.forge ?? raw.forge;
    if (raw.forge === 'none') raw.ci.default = 'off';
    raw.tagPrefix = options.tagPrefix ?? slug(path.basename(root));
    for (const key of ['records', 'plans', 'digests']) if (options[key]) raw.docs[key] = options[key];
    if (options.specs) raw.docs.specs = options.specs === 'none' ? null : options.specs;
    // §12: a brownfield repository often has no gate but its check, so both default to it.
    raw.commands = { check: options.check, 'step-check': options.stepCheck ?? options.check, gate: options.gate ?? options.check };
    config = normalize(raw, CONFIG_FILE);
    writeFileSync(configFile, `${JSON.stringify(raw, null, 2)}\n`);
    actions.push({ action: 'wrote', path: CONFIG_FILE });
  }
  const { docs } = config;

  // The ledger, three files (§4.7).
  const tags = config.release
    ? `Tags: \`${config.release.tag}\`, the version in \`${config.release.versionFile}\`, bumped by \`/slipway:ship\`.`
    : `Tags: \`${config.tagPrefix}-D<n>\`, one per shipped deliverable.`;
  writeNew(path.join(abs(docs.plans), 'README.md'), render(template('ledger.md'), { tags }));
  writeNew(path.join(abs(docs.plans), 'ROADMAP.md'), template('roadmap.md'));
  writeNew(path.join(abs(docs.plans), 'SHIPPED.md'), template('shipped.md'));

  // The records folder and its index. Brownfield adopts the records already there (§12).
  const recordsDir = abs(docs.records);
  const existing = existsSync(recordsDir)
    ? readdirSync(recordsDir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    : [];
  if (existing.length && options.brownfield) {
    actions.push({ action: 'adopted', path: docs.records, note: `${existing.length} existing records, read as records without ## Rules` });
  } else if (existing.length) {
    warnings.push(`${docs.records} already holds ${existing.length} records; run init --brownfield to adopt them (§12)`);
  }
  writeNew(path.join(recordsDir, 'README.md'), render(template('records-index.md'), { digests: docs.digests }));

  // Digests and their loaders: one general, plus one per area when areas are named (§5.2, §11).
  const digests = [{ name: 'general', scope: 'the whole repository', paths: null }];
  for (const [area, { paths }] of Object.entries(config.areas)) digests.push({ name: area, scope: `\`${area}\``, paths });
  for (const d of digests) {
    const digest = posix(path.join(docs.digests, `${d.name}.md`));
    writeNew(abs(digest), render(template('digest.md'), { area: d.name, scope: d.scope }));
    // A loader with paths loads when Claude works on a matching file; one without loads in every session.
    const frontmatter = d.paths ? `---\npaths:\n${d.paths.map((p) => `  - ${JSON.stringify(p)}`).join('\n')}\n---\n\n` : '';
    const loader = path.join(root, '.claude', 'rules', d.paths ? `slipway-${d.name}.md` : 'slipway.md');
    writeNew(loader, render(template('rules-loader.md'), { frontmatter, records: docs.records, digest }));
  }
  if (docs.specs) {
    const specs = abs(docs.specs);
    if (existsSync(specs)) actions.push({ action: 'kept', path: docs.specs });
    else writeNew(path.join(specs, '.gitkeep'), '');
  }

  // .claude/settings.json gains the marketplace and the plugin, keeping everything else (§13.4).
  const settingsFile = path.join(root, '.claude', 'settings.json');
  const fragment = JSON.parse(template('settings-fragment.json'));
  let settings = {};
  if (existsSync(settingsFile)) settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  let changed = false;
  for (const [key, entries] of Object.entries(fragment)) {
    settings[key] ??= {};
    for (const [name, value] of Object.entries(entries)) {
      if (!Object.hasOwn(settings[key], name)) {
        settings[key][name] = value;
        changed = true;
      }
    }
  }
  if (changed) {
    const had = existsSync(settingsFile);
    mkdirSync(path.dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    actions.push({ action: had ? 'updated' : 'wrote', path: rel(settingsFile) });
  } else actions.push({ action: 'kept', path: rel(settingsFile) });

  // The one always-on sentence lives in the repository's CLAUDE.md; the plugin's own is never loaded (§13.1).
  appendOnce(path.join(root, 'CLAUDE.md'), '<!-- slipway -->', template('claude-md.md'), actions, rel);
  // Each clone installs the plugin once; the README says how (§10, §13.4).
  appendOnce(path.join(root, 'README.md'), 'claude plugin install slipway@slipway', template('readme-setup.md'), actions, rel);

  const warning = claudeVersionWarning(pluginRoot, installedClaude);
  if (warning) warnings.push(warning);
  return { config, actions, warnings };
}

function appendOnce(file, marker, text, actions, rel) {
  const had = existsSync(file);
  const current = had ? readFileSync(file, 'utf8') : '';
  if (current.includes(marker)) {
    actions.push({ action: 'kept', path: rel(file) });
    return;
  }
  const body = had ? `${current.replace(/\s*$/, '\n')}${text}` : text.replace(/^\n/, '');
  writeFileSync(file, body);
  actions.push({ action: had ? 'updated' : 'wrote', path: rel(file) });
}

/** Parse `slipway init` arguments. */
export function parseInitArgs(args) {
  const flags = {
    '--check': 'check',
    '--step-check': 'stepCheck',
    '--gate': 'gate',
    '--tag-prefix': 'tagPrefix',
    '--forge': 'forge',
    '--records': 'records',
    '--plans': 'plans',
    '--digests': 'digests',
    '--specs': 'specs',
  };
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--brownfield') options.brownfield = true;
    else if (Object.hasOwn(flags, a)) {
      if (i + 1 >= args.length) throw Object.assign(new Error(`${a} needs a value`), { code: 'EUSAGE' });
      options[flags[a]] = args[++i];
    } else {
      const eq = a.indexOf('=');
      if (eq > 0 && Object.hasOwn(flags, a.slice(0, eq))) options[flags[a.slice(0, eq)]] = a.slice(eq + 1);
      else throw Object.assign(new Error(`unknown option ${a}`), { code: 'EUSAGE' });
    }
  }
  return options;
}
