// `slipway init`: make a repository ready (docs/design.md §3.2, §4.7, §12, §13.4).
// It never overwrites: a file that exists is kept, and a shared file (settings, CLAUDE.md, README) only gains
// what is missing. Running it twice changes nothing.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CONFIG_FILE, loadConfig, normalize } from './config.mjs';
import { currentBranch } from './git.mjs';
import { format, renderDigests } from './digest.mjs';
import { isGlob } from './glob.mjs';
import { LEDGER_HEADER, SHIPPED_HEADER, rowLine, shippedLine, splitLegacy, withRows } from './ledger.mjs';
import { INDEX_HEADER, listRecords, newRecord, today, upsertIndexRow } from './records.mjs';

export const BUDGET_FILE = 'slipway.budget.json';

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

  // Read the shared settings first, so a broken file stops init before it writes anything.
  const settingsFile = path.join(root, '.claude', 'settings.json');
  const settings = readSettings(settingsFile, rel(settingsFile));

  // The config: kept when present, otherwise made from the template and the options.
  const configFile = path.join(root, CONFIG_FILE);
  let config;
  if (existsSync(configFile)) {
    config = loadConfig(root);
    actions.push({ action: 'kept', path: CONFIG_FILE });
    const ignored = CONFIG_OPTIONS.filter((k) => options[k] !== undefined).map((k) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    if (ignored.length) warnings.push(`${CONFIG_FILE} exists, so ${ignored.join(', ')} changed nothing; edit the file instead`);
  } else {
    if (!options.check) {
      const e = new Error('a new config needs the command that proves the tree: --check "<command>"');
      e.code = 'EUSAGE';
      throw e;
    }
    const raw = JSON.parse(template('slipway.config.json'));
    raw.defaultBranch = options.defaultBranch ?? defaultBranchOf(root) ?? raw.defaultBranch;
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
  const ledgerFile = path.join(abs(docs.plans), 'README.md');
  const ledger = render(template('ledger.md'), { tags });
  const legacy = existsSync(ledgerFile) && !readFileSync(ledgerFile, 'utf8').split(/\r?\n/).some((l) => l.trim() === LEDGER_HEADER);
  const roadmapFile = path.join(abs(docs.plans), 'ROADMAP.md');
  const shippedFile = path.join(abs(docs.plans), 'SHIPPED.md');
  if (legacy && !options.brownfield) {
    warnings.push(`${rel(ledgerFile)} is a ledger in another shape; run init --brownfield to split it into the three files (§13.5)`);
  } else if (legacy && (existsSync(roadmapFile) || existsSync(shippedFile))) {
    warnings.push(`${rel(ledgerFile)} is a ledger in another shape, but ROADMAP.md or SHIPPED.md already exists beside it; split it by hand`);
  } else if (legacy) {
    // §13.5 step 5: open rows to the ledger, shipped rows to SHIPPED.md, everything else to ROADMAP.md whole.
    const split = splitLegacy(readFileSync(ledgerFile, 'utf8'));
    writeFileSync(ledgerFile, withRows(ledger, LEDGER_HEADER, split.open, rowLine));
    writeFileSync(shippedFile, withRows(template('shipped.md'), SHIPPED_HEADER, split.shipped, shippedLine));
    const roadmap = template('roadmap.md');
    writeFileSync(roadmapFile, split.rest ? `${roadmap.trimEnd()}\n\n## From the previous ledger\n\n${split.rest}\n` : roadmap);
    actions.push({ action: 'split', path: rel(ledgerFile), note: `${split.open.length} open rows kept, ${split.shipped.length} to SHIPPED.md, the rest to ROADMAP.md` });
    actions.push({ action: 'wrote', path: rel(shippedFile) }, { action: 'wrote', path: rel(roadmapFile) });
    if (split.unread.length) warnings.push(`kept as planned, status not read: ${split.unread.join(', ')}`);
  }
  // A ledger in another shape is left whole until --brownfield splits it, so the split can still happen.
  if (!legacy) {
    writeNew(ledgerFile, ledger);
    writeNew(roadmapFile, template('roadmap.md'));
    writeNew(shippedFile, template('shipped.md'));
  }

  // The records folder and its index. Brownfield adopts the records already there (§12).
  const recordsDir = abs(docs.records);
  const indexFile = path.join(recordsDir, 'README.md');
  const existing = listRecords(recordsDir);
  const indexHad = existsSync(indexFile);
  const slipwayIndex = indexHad && readFileSync(indexFile, 'utf8').split(/\r?\n/).some((l) => l.trim() === INDEX_HEADER);
  // Records or an index without Slipway's table are the repository's own, adopted only when asked (§12).
  const adopt = existing.length > 0 && !slipwayIndex;
  if ((adopt || (indexHad && !slipwayIndex)) && !options.brownfield) {
    warnings.push(
      adopt
        ? `${docs.records} already holds ${existing.length} records; run init --brownfield to adopt them (§12)`
        : `${rel(indexFile)} is an index of the repository's own; run init --brownfield to add Slipway's table to it (§12)`,
    );
  } else {
    const header = render(template('records-index.md'), { digests: docs.digests });
    if (!slipwayIndex) {
      mkdirSync(recordsDir, { recursive: true });
      // An index of the repository's own keeps what it says, and gains Slipway's table below it.
      writeFileSync(indexFile, indexHad ? `${readFileSync(indexFile, 'utf8').trimEnd()}\n\n${header.replace(/^#.*\n+/, '')}` : header);
      for (const r of existing) upsertIndexRow(indexFile, r);
      actions.push({ action: indexHad ? 'updated' : 'wrote', path: rel(indexFile) });
    }
    if (adopt) actions.push({ action: 'adopted', path: docs.records, note: `${existing.length} existing records, read as records without ## Rules` });
    // The process record (§5.1): the first record of a new corpus, accepted; proposed beside an adopted one,
    // for the adopting lane to accept when it supersedes the old chain (§13.5 step 6).
    if (!existing.some((r) => /^(\d+\.\s*)?the process$/i.test(r.title))) {
      const text = render(template('process-record.md'), { plans: docs.plans, digests: docs.digests, status: 'proposed' });
      const r = newRecord(recordsDir, text, { title: 'The process', status: existing.length ? 'proposed' : 'accepted', date: options.date ?? today() });
      actions.push({ action: 'wrote', path: rel(path.join(recordsDir, r.file)), note: r.status });
      if (slipwayIndex) actions.push({ action: 'updated', path: rel(indexFile) });
    } else if (slipwayIndex) actions.push({ action: 'kept', path: rel(indexFile) });
  }

  // Digests and their loaders: one general, plus one per area when areas are named (§5.2, §11).
  // Generated as `slipway digest` would, so the first docs-check finds them current.
  const rendered = renderDigests(root, config, template('digest.md'));
  for (const p of rendered.problems) warnings.push(`digest: ${p}`);
  const digests = [{ name: 'general', scope: 'the whole repository', paths: null }];
  const fresh = [];
  for (const [area, { paths }] of Object.entries(config.areas)) digests.push({ name: area, scope: `\`${area}\``, paths });
  for (const d of digests) {
    const digest = posix(path.join(docs.digests, `${d.name}.md`));
    if (!existsSync(abs(digest))) fresh.push(digest);
    writeNew(abs(digest), rendered.digests[d.name].text);
    // A loader with paths loads when Claude works on a matching file; one without loads in every session.
    const frontmatter = d.paths ? `---\npaths:\n${d.paths.map((p) => `  - ${JSON.stringify(p)}`).join('\n')}\n---\n\n` : '';
    const loader = path.join(root, '.claude', 'rules', d.paths ? `slipway-${d.name}.md` : 'slipway.md');
    // An @ import resolves against the file that holds it, so the path is relative to the loader.
    const imported = posix(path.relative(path.dirname(loader), abs(digest)));
    writeNew(loader, render(template('rules-loader.md'), { frontmatter, records: docs.records, digest: imported }));
  }
  // The repository's formatter gets the new digests too, as `slipway digest` would give them (§3.3).
  try {
    format(root, config, fresh);
  } catch (err) {
    warnings.push(err.message);
  }
  if (docs.specs) {
    const specs = abs(docs.specs);
    if (existsSync(specs)) actions.push({ action: 'kept', path: docs.specs });
    else writeNew(path.join(specs, '.gitkeep'), '');
  }

  // .claude/settings.json gains the marketplace and the plugin, keeping everything else (§13.4).
  const fragment = JSON.parse(template('settings-fragment.json'));
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
  // A repository that is itself a plugin takes .claude/CLAUDE.md: `claude plugin validate --strict` warns of a
  // CLAUDE.md at a plugin's root.
  const isPlugin = existsSync(path.join(root, '.claude-plugin', 'plugin.json'));
  const claudeMd =
    [path.join(root, 'CLAUDE.md'), path.join(root, '.claude', 'CLAUDE.md')].find(existsSync) ??
    path.join(root, ...(isPlugin ? ['.claude', 'CLAUDE.md'] : ['CLAUDE.md']));
  appendOnce(claudeMd, '<!-- slipway -->', template('claude-md.md'), actions, rel);
  // Each clone installs the plugin once; the README says how (§10, §13.4).
  const readme = readdirSync(root).find((f) => /^readme\.(md|markdown)$/i.test(f)) ?? 'README.md';
  appendOnce(path.join(root, readme), 'claude plugin install slipway@slipway', template('readme-setup.md'), actions, rel);

  // Byte ceilings for the files a session is told to read (§7, §14); never below a file's size today (§12).
  writeBudget(root, config, rel(claudeMd), actions);

  const warning = claudeVersionWarning(pluginRoot, installedClaude);
  if (warning) warnings.push(warning);
  return { config, actions, warnings };
}

const CONFIG_OPTIONS = ['check', 'stepCheck', 'gate', 'tagPrefix', 'forge', 'records', 'plans', 'digests', 'specs', 'defaultBranch'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function readSettings(file, name) {
  if (!existsSync(file)) return {};
  let settings;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${name} is not valid JSON (${err.message}); fix it and run init again`);
  }
  if (!isObject(settings)) throw new Error(`${name} must hold one JSON object`);
  for (const key of ['extraKnownMarketplaces', 'enabledPlugins']) {
    if (settings[key] !== undefined && !isObject(settings[key])) throw new Error(`${name}: ${key} must be an object`);
  }
  return settings;
}

/** The repository's default branch: the remote's HEAD, else the only local branch, else null. */
function defaultBranchOf(root) {
  const remote = gitOut(root, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']);
  if (remote) return remote.replace(/^origin\//, '');
  const branches = gitOut(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  const list = branches ? branches.split('\n') : [];
  if (list.length <= 1) return currentBranch(root);
  return null;
}

function gitOut(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

/** The default ceilings, in bytes, by path or glob. */
export function defaultBudget(config, claudeMd = 'CLAUDE.md') {
  const { plans, digests } = config.docs;
  return {
    [claudeMd]: 4096,
    [`${plans}/README.md`]: 8192,
    [`${plans}/ROADMAP.md`]: 32768,
    [`${plans}/D*.md`]: 16384,
    [`${plans}/D*.decisions.md`]: 4096,
    [`${digests}/general.md`]: 12288,
    [`${digests}/*.md`]: 32768,
    '.claude/rules/*.md': 1024,
  };
}

function writeBudget(root, config, claudeMd, actions) {
  const file = path.join(root, BUDGET_FILE);
  if (existsSync(file)) {
    actions.push({ action: 'kept', path: BUDGET_FILE });
    return;
  }
  const budget = defaultBudget(config, claudeMd);
  for (const [p, ceiling] of Object.entries(budget)) {
    if (isGlob(p) || !existsSync(path.join(root, p))) continue;
    budget[p] = Math.max(ceiling, statSync(path.join(root, p)).size);
  }
  writeFileSync(file, `${JSON.stringify(budget, null, 2)}\n`);
  actions.push({ action: 'wrote', path: BUDGET_FILE });
}

function appendOnce(file, marker, text, actions, rel) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const had = current.trim() !== '';
  if (current.includes(marker)) {
    actions.push({ action: 'kept', path: rel(file) });
    return;
  }
  const body = had ? `${current.trimEnd()}\n${text}` : text.replace(/^\n/, '');
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
    '--default-branch': 'defaultBranch',
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
