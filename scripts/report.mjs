// A step builder's fixed load: what it reads before it reads code, in bytes, by part (docs/design.md §7).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { overlaps, pathGlobs, stepBrief } from './lane.mjs';
import { linkedRecords } from './plan.mjs';

/** v0.2's done-when (§9): a step's fixed load under 40 KB. */
export const TARGET = 40 * 1024;
/** Measured on v0.2's runs (docs/measurements.md): the process's prose comes to about 2.5 bytes a token. */
export const BYTES_PER_TOKEN = 2.5;

const posix = (p) => p.split(path.sep).join('/');
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const MAX_IMPORT_DEPTH = 5;

/** A file's text without its YAML frontmatter, which Claude Code reads as settings, not as context. */
export const body = (text) => text.replace(FRONTMATTER, '').replace(/^(\r?\n)+/, '');

/** The `paths:` globs of a rule file's frontmatter, or null when it has none and so loads in every session. */
export function rulePaths(text) {
  const fm = FRONTMATTER.exec(text);
  if (!fm) return null;
  const lines = fm[0].split(/\r?\n/);
  const i = lines.findIndex((l) => /^paths:\s*$/.test(l) || /^paths:\s*\S/.test(l));
  if (i < 0) return null;
  const inline = /^paths:\s*(\S.*)$/.exec(lines[i]);
  if (inline) return splitFlow(inline[1].trim().replace(/^\[|\]$/g, '')).map(unquote).filter(Boolean);
  const globs = [];
  for (const l of lines.slice(i + 1)) {
    const m = /^\s+-\s*(.+)$/.exec(l);
    if (!m) break;
    globs.push(unquote(m[1]));
  }
  return globs;
}
const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2');

/** A YAML flow list's items: commas inside quotes or a glob's braces (`src/{a,b}/**`) do not split. */
function splitFlow(text) {
  const items = [];
  let item = '';
  let quote = null;
  let depth = 0;
  for (const c of text) {
    if (quote) quote = c === quote ? null : quote;
    else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      items.push(item);
      item = '';
      continue;
    }
    item += c;
  }
  return [...items, item];
}

/** True when abs is inside root (not on another drive, not above it). */
function inside(root, abs) {
  const rel = path.relative(root, abs);
  return rel !== '' && !path.isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..';
}

/** The `@path` imports of a memory file, outside code spans and fences, as Claude Code resolves them. */
export function imports(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/(?:^|\s)@([^\s]+)/g)) out.push(m[1]);
  }
  return out;
}

/**
 * A memory file and what it imports, recursively and once each, inside the repository.
 * Pushes { file, bytes } onto `files`; `seen` holds absolute paths already counted.
 */
function withImports(root, abs, { files, seen, depth = 0 }) {
  if (seen.has(abs) || !isFile(abs)) return;
  seen.add(abs);
  // Frontmatter is settings, not context, in every memory file Claude Code reads.
  const text = body(readFileSync(abs, 'utf8'));
  files.push({ file: posix(path.relative(root, abs)), bytes: Buffer.byteLength(text) });
  if (depth >= MAX_IMPORT_DEPTH) return;
  for (const imp of imports(text)) {
    const target = importTarget(root, abs, imp);
    if (target) withImports(root, target, { files, seen, depth: depth + 1 });
  }
}

const isFile = (abs) => existsSync(abs) && statSync(abs).isFile();

/** Where an import points, inside the repository; a sentence's closing punctuation is not part of the path. */
function importTarget(root, from, imp) {
  if (imp.startsWith('~')) return null; // a user's own file, not the repository's
  for (const candidate of [imp, imp.replace(/[.,;:!?)]+$/, '')]) {
    const target = path.resolve(path.dirname(from), candidate);
    if (inside(root, target) && isFile(target)) return target;
  }
  return null;
}

/** Every rule file under .claude/rules, with its `paths:` globs (null: always loaded). */
function ruleFiles(root) {
  const dir = path.join(root, '.claude', 'rules');
  const found = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) found.push({ abs: p, paths: rulePaths(readFileSync(p, 'utf8')) });
    }
  };
  walk(dir);
  return found;
}

/** The folders below the root on the way to each glob's literal prefix: `src/api/**` → src, src/api. */
function folders(globs) {
  const out = [];
  for (const g of globs) {
    const parts = g.replaceAll('\\', '/').split(/[*?[{]/)[0].split('/');
    parts.pop(); // the last segment is a file name, or empty after a trailing slash
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (dir && !out.includes(dir)) out.push(dir);
    }
  }
  return out;
}

/** The SKILL.md of a conventions skill the repository keeps, or null (a plugin's or a user's skill). */
function skillFile(root, name) {
  const f = path.join(root, '.claude', 'skills', name, 'SKILL.md');
  return existsSync(f) ? f : null;
}

/**
 * The fixed load of step `k` of a lane (§7): the always-on memory files and the rules they import, the
 * step-builder's body, what `slipway lane --step` prints, the rules of the areas its paths reach, and its
 * conventions skills. The records it names, the spec and the code are not fixed load. Returns
 * { k, title, parts: [{ name, files: [{ file, bytes }], bytes }], total, notCounted }.
 */
export function fixedLoad(root, config, lane, k, pluginRoot) {
  const brief = stepBrief(config, lane, k);
  if (!brief) return null;
  const seen = new Set();
  const part = (name, files) => ({ name, files, bytes: files.reduce((s, f) => s + f.bytes, 0) });

  // Always on: the project's memory files at the worktree's root, and the rules without `paths:`.
  const always = [];
  for (const f of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md']) withImports(root, path.join(root, f), { files: always, seen });
  const rules = ruleFiles(root);
  for (const r of rules.filter((r) => r.paths === null)) withImports(root, r.abs, { files: always, seen });
  // Claude Code reads a path-scoped rule's @ imports at session start too: only the rule's own text waits for a
  // matching file. An area digest imported that way is always on (an inline one, as `slipway digest` writes, is not).
  for (const r of rules.filter((r) => r.paths !== null)) {
    for (const imp of imports(body(readFileSync(r.abs, 'utf8')))) {
      const target = importTarget(root, r.abs, imp);
      if (target) withImports(root, target, { files: always, seen });
    }
  }

  // The procedure: the agent's body is its system prompt.
  const agent = path.join(pluginRoot, 'agents', 'step-builder.md');
  const procedure = existsSync(agent) ? [{ file: 'step-builder (agent body)', bytes: Buffer.byteLength(body(readFileSync(agent, 'utf8'))) }] : [];

  const step = [{ file: `slipway lane --step ${k}`, bytes: Buffer.byteLength(`${brief.text}\n`) }];

  // Area rules: a rule whose `paths:` reach the step's paths loads when the builder reads a file there, and so
  // does a CLAUDE.md in a folder on the way to them.
  const globs = pathGlobs(brief.step.fields.Paths);
  const area = [];
  for (const dir of folders(globs)) {
    for (const f of ['CLAUDE.md', 'CLAUDE.local.md']) withImports(root, path.join(root, dir, f), { files: area, seen });
  }
  for (const r of rules.filter((r) => r.paths !== null && r.paths.some((a) => globs.some((g) => overlaps(a, g))))) {
    if (seen.has(r.abs)) continue;
    seen.add(r.abs);
    area.push({ file: posix(path.relative(root, r.abs)), bytes: Buffer.byteLength(body(readFileSync(r.abs, 'utf8'))) });
  }

  const conventions = [];
  const missing = [];
  for (const s of brief.skills) {
    const f = skillFile(root, s);
    if (f) conventions.push({ file: posix(path.relative(root, f)), bytes: Buffer.byteLength(body(readFileSync(f, 'utf8'))) });
    else missing.push(s);
  }

  const parts = [part('always on', always), part('procedure', procedure), part('the step', step), part('area rules', area), part('conventions', conventions)];
  const records = linkedRecords(brief.step.fields.Records);
  return {
    k,
    title: brief.step.title,
    parts,
    total: parts.reduce((s, p) => s + p.bytes, 0),
    missingSkills: missing,
    notCounted: [records.length ? `the records it names (${records.join(', ')})` : null, 'the spec', 'the code'].filter(Boolean),
  };
}

const n = (x) => x.toLocaleString('en-US');
const kb = (x) => `${(x / 1024).toFixed(1)} KB`;

/** The report as lines of text. */
export function formatReport(lane, load) {
  const width = Math.max(...load.parts.map((p) => p.name.length));
  const lines = [`D${lane.n}.${load.k} ${load.title} — a step builder's fixed load (§7)`, ''];
  for (const p of load.parts) {
    lines.push(`${p.name.padEnd(width)}  ${n(p.bytes).padStart(7)}`);
    for (const f of p.files) lines.push(`${' '.repeat(width)}    ${n(f.bytes).padStart(7)}  ${f.file}`);
  }
  lines.push('');
  const tokens = Math.round(load.total / BYTES_PER_TOKEN);
  const verdict = load.total <= TARGET ? 'under' : 'OVER';
  lines.push(`total: ${n(load.total)} bytes (${kb(load.total)}, ≈ ${n(tokens)} tokens), ${verdict} the ${kb(TARGET)} target`);
  if (load.missingSkills.length) lines.push(`not found in .claude/skills, not counted: ${load.missingSkills.join(', ')}`);
  lines.push(`not fixed load: ${load.notCounted.join(', ')}`);
  return lines;
}
