// slipway.config.json: the schema, its defaults, and the lane-name helpers (docs/design.md §3.3, §11).
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'slipway.config.json';

const FORGES = ['github', 'none'];
const CI_VALUES = ['on', 'at-ship', 'off'];
const CI_MAIN_VALUES = ['on', 'off'];
const MERGES = ['merge-commit', 'squash'];
const REQUIRED_COMMANDS = ['check', 'step-check', 'gate'];
const NAME = /^[a-z][a-z0-9-]*$/;

export class ConfigError extends Error {
  constructor(file, problems) {
    super(`${file}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string' && v.length > 0;

/** Validate a parsed config and return it with every default filled in. Throws ConfigError. */
export function normalize(raw, file = CONFIG_FILE) {
  const problems = [];
  const bad = (where, what) => problems.push(`${where}: ${what}`);
  const known = (obj, where, keys) => {
    for (const k of Object.keys(obj)) if (!keys.includes(k)) bad(where ? `${where}.${k}` : k, 'unknown key');
  };
  const oneOf = (v, where, values, fallback) => {
    if (v === undefined) return fallback;
    if (!values.includes(v)) bad(where, `must be one of ${values.map((x) => JSON.stringify(x)).join(', ')}`);
    return v;
  };
  const str = (v, where, fallback, { nullable = false } = {}) => {
    if (v === undefined) return fallback;
    if (v === null && nullable) return null;
    if (!isString(v)) bad(where, nullable ? 'must be a non-empty string or null' : 'must be a non-empty string');
    return v;
  };
  const strings = (v, where, fallback, { nonEmpty = false } = {}) => {
    if (v === undefined) return fallback;
    if (!Array.isArray(v) || !v.every(isString)) bad(where, 'must be a list of non-empty strings');
    else if (nonEmpty && v.length === 0) bad(where, 'must not be empty');
    return v;
  };
  const section = (v, where) => {
    if (v === undefined) return {};
    if (!isObject(v)) {
      bad(where, 'must be an object');
      return {};
    }
    return v;
  };

  if (!isObject(raw)) throw new ConfigError(file, ['the file must hold one JSON object']);
  known(raw, '', ['$schema', 'version', 'defaultBranch', 'forge', 'tagPrefix', 'docs', 'lane', 'commands', 'locks', 'ci', 'release', 'merge', 'areas']);

  if (raw.version !== 1) bad('version', 'must be 1');
  const defaultBranch = str(raw.defaultBranch, 'defaultBranch', 'main');
  const forge = oneOf(raw.forge, 'forge', FORGES, 'github');

  const docsIn = section(raw.docs, 'docs');
  known(docsIn, 'docs', ['records', 'plans', 'digests', 'specs']);
  const docs = {
    records: str(docsIn.records, 'docs.records', 'docs/adr'),
    plans: str(docsIn.plans, 'docs.plans', 'docs/plan'),
    digests: str(docsIn.digests, 'docs.digests', 'docs/rules'),
    specs: str(docsIn.specs, 'docs.specs', 'docs/specs', { nullable: true }),
  };

  const laneIn = section(raw.lane, 'lane');
  known(laneIn, 'lane', ['branch', 'worktree', 'copy', 'setup']);
  const lane = {
    branch: str(laneIn.branch, 'lane.branch', 'lane/D{n}'),
    worktree: str(laneIn.worktree, 'lane.worktree', '../{repo}-D{n}'),
    copy: strings(laneIn.copy, 'lane.copy', []),
    setup: str(laneIn.setup, 'lane.setup', null, { nullable: true }),
  };
  for (const key of ['branch', 'worktree']) {
    if (isString(lane[key]) && lane[key].split('{n}').length !== 2) bad(`lane.${key}`, 'must contain {n} exactly once');
  }

  const commands = {};
  if (!isObject(raw.commands)) bad('commands', 'required: an object naming at least check, step-check and gate');
  else {
    for (const [name, cmd] of Object.entries(raw.commands)) {
      if (!NAME.test(name)) bad(`commands.${name}`, 'a command name is lower-case letters, digits and hyphens');
      if (!isString(cmd)) bad(`commands.${name}`, 'must be a non-empty string');
      commands[name] = cmd;
    }
    for (const name of REQUIRED_COMMANDS) if (!Object.hasOwn(raw.commands, name)) bad(`commands.${name}`, 'required');
  }

  const locksIn = section(raw.locks, 'locks');
  known(locksIn, 'locks', ['tiers']);
  const locks = { tiers: strings(locksIn.tiers, 'locks.tiers', []) };
  if (Array.isArray(locks.tiers)) {
    for (const name of locks.tiers) {
      if (isString(name) && !Object.hasOwn(commands, name)) bad('locks.tiers', `"${name}" is not a command`);
    }
  }

  const ciIn = section(raw.ci, 'ci');
  known(ciIn, 'ci', ['default', 'workflow', 'main']);
  const ci = {
    default: oneOf(ciIn.default, 'ci.default', CI_VALUES, forge === 'none' ? 'off' : 'on'),
    workflow: str(ciIn.workflow, 'ci.workflow', null, { nullable: true }),
    main: oneOf(ciIn.main, 'ci.main', CI_MAIN_VALUES, 'on'),
  };
  if (forge === 'none' && ci.default !== 'off') bad('ci.default', 'must be "off" when forge is "none" (§3.3)');

  let release = null;
  if (raw.release !== undefined && raw.release !== null) {
    if (!isObject(raw.release)) bad('release', 'must be an object or null');
    else {
      known(raw.release, 'release', ['tag', 'versionFile', 'also']);
      release = {
        tag: str(raw.release.tag, 'release.tag', 'v{version}'),
        versionFile: str(raw.release.versionFile, 'release.versionFile', undefined),
        also: strings(raw.release.also, 'release.also', []),
      };
      if (release.versionFile === undefined) bad('release.versionFile', 'required when release is set');
      if (isString(release.tag) && !release.tag.includes('{version}')) bad('release.tag', 'must contain {version}');
    }
  }

  const tagPrefix = str(raw.tagPrefix, 'tagPrefix', null);
  if (tagPrefix === null && release === null) bad('tagPrefix', 'required unless release is set (§4.5 step 8)');

  const merge = oneOf(raw.merge, 'merge', MERGES, 'merge-commit');

  const areas = {};
  for (const [slug, area] of Object.entries(section(raw.areas, 'areas'))) {
    const where = `areas.${slug}`;
    if (!NAME.test(slug)) bad(where, 'an area slug is lower-case letters, digits and hyphens');
    if (!isObject(area)) {
      bad(where, 'must be an object');
      continue;
    }
    known(area, where, ['paths', 'skills']);
    areas[slug] = {
      paths: strings(area.paths, `${where}.paths`, undefined, { nonEmpty: true }),
      skills: strings(area.skills, `${where}.skills`, []),
    };
    if (area.paths === undefined) bad(`${where}.paths`, 'required');
  }

  if (problems.length) throw new ConfigError(file, problems);
  return {
    version: 1,
    defaultBranch,
    forge,
    tagPrefix,
    docs,
    lane,
    commands,
    locks,
    ci,
    release,
    merge,
    areas,
  };
}

/** Read and normalize `<root>/slipway.config.json`. Throws ConfigError, or an Error with code ENOENT. */
export function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const e = new Error(`no ${CONFIG_FILE} at ${root}; run /slipway:init first`);
      e.code = 'ENOENT';
      throw e;
    }
    throw err;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(file, [`not valid JSON: ${err.message}`]);
  }
  return normalize(raw, file);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The lane a branch belongs to, from the lane.branch pattern: `lane/D45` → { n: 45, id: 'd45' }, else null. */
export function laneFromBranch(config, branch) {
  if (!branch) return null;
  const [before, after] = config.lane.branch.split('{n}');
  const m = new RegExp(`^${escapeRegExp(before)}(0|[1-9]\\d*)${escapeRegExp(after)}$`).exec(branch);
  if (!m) return null;
  const n = Number(m[1]);
  return { n, id: `d${n}` };
}

/** The branch name for deliverable n. */
export const laneBranch = (config, n) => config.lane.branch.replace('{n}', String(n));

/** The absolute worktree path for deliverable n, relative to the repository root. */
export const laneWorktree = (config, root, n) =>
  path.resolve(root, config.lane.worktree.replace('{n}', String(n)).replaceAll('{repo}', path.basename(root)));
