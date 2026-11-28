// The version bump, the release notes and the tag (docs/design.md §4.5 step 8, §14).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releaseTag, releaseTitle } from './config.mjs';
import { RELEASE_PARTS } from './plan.mjs';
import { today } from './records.mjs';

export const CHANGELOG = 'CHANGELOG.md';

const usage = (message) => Object.assign(new Error(message), { code: 'EUSAGE' });
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The version a file holds: a JSON "version", a `version = "…"` line, or the whole of a plain file. */
export function readVersion(text) {
  const m = /"version"\s*:\s*"([^"]+)"/.exec(text) ?? /^\s*version\s*=\s*"([^"]+)"/m.exec(text);
  if (m) return m[1];
  const plain = text.trim();
  if (/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(plain)) return plain;
  return null;
}

export function bumpVersion(version, part) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw usage(`"${version}" is not a semver version`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (part === 'major') return `${maj + 1}.0.0`;
  if (part === 'minor') return `${maj}.${min + 1}.0`;
  if (part === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw usage(`the part is one of ${RELEASE_PARTS.join(', ')}`);
}

/** Replace the first `from` written as a version value in a file's text: the file's own, not a dependency's. */
function replaceVersion(text, from, to) {
  const json = new RegExp(`("version"\\s*:\\s*")${escape(from)}(")`);
  const toml = new RegExp(`^(\\s*version\\s*=\\s*")${escape(from)}(")`, 'm');
  if (json.test(text)) return text.replace(json, (m, a, b) => `${a}${to}${b}`);
  if (toml.test(text)) return text.replace(toml, (m, a, b) => `${a}${to}${b}`);
  if (text.trim() === from) return text.replace(from, to);
  return null;
}

// `## Unreleased`, or Keep a Changelog's `## [Unreleased]`.
const UNRELEASED = /^## (?:\[Unreleased\]|Unreleased)[ \t]*(?=\r?$)/m;

/**
 * Bump the release version in versionFile and every file under also, and rename a root CHANGELOG.md's
 * `## Unreleased` heading to `## <version> — <date>`, or a bracketed `## [Unreleased]` to Keep a Changelog's
 * `## [<version>] - <date>`. Nothing is written unless every file can be.
 * Returns { from, to, tag, title, files }.
 */
export function bump(root, config, part, { date = today() } = {}) {
  if (!config.release) throw usage('slipway.config.json has no release block; the tag is <tagPrefix>-D<n>');
  const files = [config.release.versionFile, ...config.release.also];
  const from = readVersion(readFileSync(path.join(root, config.release.versionFile), 'utf8'));
  if (!from) throw usage(`${config.release.versionFile} holds no version`);
  const to = bumpVersion(from, part);
  const updated = files.map((f) => {
    const abs = path.join(root, f);
    if (!existsSync(abs)) throw usage(`${f} does not exist`);
    const text = replaceVersion(readFileSync(abs, 'utf8'), from, to);
    if (text === null) throw usage(`${f} does not hold version ${from}`);
    return [abs, text];
  });
  const changelog = path.join(root, CHANGELOG);
  if (existsSync(changelog)) {
    const text = readFileSync(changelog, 'utf8');
    const m = UNRELEASED.exec(text);
    if (!m) throw usage(`${CHANGELOG} has no "## Unreleased" heading for ${to}`);
    const heading = m[0].includes('[') ? `## [${to}] - ${date}` : `## ${to} — ${date}`;
    updated.push([changelog, text.replace(UNRELEASED, heading)]);
    files.push(CHANGELOG);
  }
  for (const [abs, text] of updated) writeFileSync(abs, text);
  return { from, to, tag: releaseTag(config, to), title: releaseTitle(config, to), files };
}

/** The version release.versionFile holds now. */
function currentVersion(root, config) {
  const v = readVersion(readFileSync(path.join(root, config.release.versionFile), 'utf8'));
  if (!v) throw usage(`${config.release.versionFile} holds no version`);
  return v;
}

/** A changelog's section for one version: the lines under its `## <version>` (or `## [<version>]`) heading, up to the next. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const v = escape(version);
  const head = new RegExp(`^## (?:\\[${v}\\]|${v})(?:\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return `${lines.slice(start + 1, end).join('\n').trim()}\n`;
}

/**
 * The current version's release: { version, tag, title, notes }, where notes is the version's section of a
 * root CHANGELOG.md, or null when there is no changelog. `out` is written with the notes.
 */
export function notes(root, config, { out } = {}) {
  if (!config.release) throw usage('slipway.config.json has no release block; a <tagPrefix>-D<n> tag has no release');
  const version = currentVersion(root, config);
  const changelog = path.join(root, CHANGELOG);
  let section = null;
  if (existsSync(changelog)) {
    section = changelogSection(readFileSync(changelog, 'utf8'), version);
    if (section === null) throw usage(`${CHANGELOG} has no "## ${version}" section; slipway release bump writes it`);
    if (out) writeFileSync(out, section);
  }
  return { version, tag: releaseTag(config, version), title: releaseTitle(config, version), notes: section };
}

/** The tag a shipped deliverable gets: `<tagPrefix>-D<n>`, or the release tag of the current version. */
export function tagName(root, config, n) {
  if (!config.release) return `${config.tagPrefix}-D${n}`;
  return releaseTag(config, currentVersion(root, config));
}

/**
 * Tag the merge commit of a lane: the commit on the default branch whose second parent is the lane's head
 * (§14). `commit` overrides the search (a squash merge has no second parent). Never moves a tag.
 */
export function tag(root, config, n, { head, commit, title = '', pr = '' } = {}) {
  const name = tagName(root, config, n);
  const origin = git(root, ['remote', 'get-url', 'origin']).status === 0;
  if (git(root, ['rev-parse', '-q', '--verify', `refs/tags/${name}`]).status === 0) throw usage(`tag ${name} already exists; a tag is never moved`);
  if (origin) {
    const remote = git(root, ['ls-remote', '--tags', 'origin', `refs/tags/${name}`]);
    if (remote.stdout.trim()) throw usage(`tag ${name} already exists on origin; a tag is never moved`);
    git(root, ['fetch', '-q', 'origin', config.defaultBranch]);
  }
  let sha = commit;
  if (!sha) {
    if (!head) throw usage('tag needs --head <the lane head that was merged>, or --commit for a squash merge');
    const ref = origin ? `origin/${config.defaultBranch}` : config.defaultBranch;
    const out = git(root, ['rev-list', '--merges', '--parents', '-n', '200', ref]).stdout ?? '';
    const full = git(root, ['rev-parse', head]).stdout.trim();
    sha = out
      .split('\n')
      .map((l) => l.split(' '))
      .find((p) => p[2] === full)?.[0];
    if (!sha) throw usage(`no merge commit on ${ref} has ${head} as its second parent`);
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'slipway-tag-'));
  try {
    const msg = path.join(dir, 'message');
    writeFileSync(msg, `D${n}. ${title}`.trim() + (pr ? `\n\n${pr}\n` : '\n'));
    const t = git(root, ['tag', '-a', '--cleanup=verbatim', '-F', msg, name, sha]);
    if (t.status !== 0) throw new Error(`git tag: ${t.stderr.trim()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (origin) {
    const p = git(root, ['push', 'origin', `refs/tags/${name}`]);
    if (p.status !== 0) throw new Error(`git push origin ${name}: ${p.stderr.trim()}`);
  }
  return { name, sha };
}
