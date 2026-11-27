// `slipway digest`: the digests generated from the `## Rules` of accepted records (docs/design.md §5.2, §14).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { quoteArg } from './run.mjs';
import { findRecord, listRecords } from './records.mjs';

const posix = (p) => p.split(path.sep).join('/');

/** The `## Rules` items of a record's text: [{ line, topic, text, with, areas }] or [{ line, malformed }]. */
export function parseRules(text) {
  const lines = text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' ')).split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Rules\s*$/.test(l));
  if (start < 0) return [];
  const items = [];
  let cur = null;
  for (let i = start + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++) {
    const l = lines[i];
    if (/^[-*] /.test(l)) {
      cur = { line: i + 1, raw: l.slice(2).trim() };
      items.push(cur);
    } else if (cur && l.trim()) cur.raw += ` ${l.trim()}`;
    else if (!l.trim()) cur = null;
  }
  return items.map(({ line, raw }) => {
    let body = raw;
    const meta = { with: [], areas: [] };
    for (;;) {
      const m = /\s*\((with|areas):\s*([^)]*)\)\s*$/.exec(body);
      if (!m) break;
      meta[m[1]].unshift(...m[2].split(/[,\s]+/).filter(Boolean));
      body = body.slice(0, m.index);
    }
    const t = /^\*\*(.+?)\*\*\s*(.*)$/.exec(body);
    if (!t || !t[2].trim()) return { line, malformed: true, raw };
    return { line, topic: t[1].trim(), text: t[2].trim(), with: meta.with, areas: meta.areas };
  });
}

export const wordCount = (rule) => `${rule.topic} ${rule.text}`.split(/\s+/).filter(Boolean).length;

/**
 * Render every digest: general, then one per area. Returns { digests: { name: { file, text } }, problems }.
 * `template` is templates/digest.md.
 */
export function renderDigests(root, config, template) {
  const recordsDir = path.join(root, config.docs.records);
  const records = listRecords(recordsDir);
  const problems = [];
  const areas = Object.keys(config.areas);
  const lines = { general: [] };
  for (const a of areas) lines[a] = [];
  const link = (r) => `[${r.number ?? r.file}](${posix(path.relative(path.join(root, config.docs.digests), path.join(recordsDir, r.file)))})`;
  for (const r of records.filter((x) => x.status === 'accepted')) {
    const where = posix(path.join(config.docs.records, r.file));
    for (const rule of parseRules(r.text)) {
      if (rule.malformed) {
        problems.push(`${where}:${rule.line}: a rule is "- **Topic.** text (with: …) (areas: …)"`);
        continue;
      }
      const cited = [];
      for (const id of rule.with) {
        try {
          const other = findRecord(records, id);
          if (other.status !== 'accepted') problems.push(`${where}:${rule.line}: (with: ${id}) cites ${other.file}, which is ${other.status}`);
          else cited.push(other);
        } catch (err) {
          problems.push(`${where}:${rule.line}: (with: ${id}): ${err.message}`);
        }
      }
      for (const a of rule.areas) if (!areas.includes(a)) problems.push(`${where}:${rule.line}: (areas: ${a}) is not an area in slipway.config.json`);
      const cite = [link(r), ...cited.map((c) => `with ${link(c)}`)].join(', ');
      const out = `- **${rule.topic}** ${rule.text} (${cite})`;
      const targets = rule.areas.filter((a) => areas.includes(a));
      for (const t of targets.length ? targets : ['general']) lines[t].push(out);
    }
  }
  const digests = {};
  for (const name of ['general', ...areas]) {
    const scope = name === 'general' ? 'the whole repository' : `the \`${name}\` area`;
    const rules = lines[name].length ? lines[name].join('\n') : 'No rules yet.';
    const text = template.replaceAll('{{area}}', () => name).replaceAll('{{scope}}', () => scope).replaceAll('{{rules}}', () => rules);
    digests[name] = { file: posix(path.join(config.docs.digests, `${name}.md`)), text: text.replace(/\n*$/, '\n') };
  }
  return { digests, problems };
}

/** Run the repository's formatter over files, when it names one (§3.3). */
export function format(root, config, files) {
  if (!config.commands.format || !files.length) return;
  const r = spawnSync(`${config.commands.format} ${files.map((f) => quoteArg(f)).join(' ')}`, { cwd: root, shell: true, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`commands.format failed on the digests: ${r.stderr.trim()}`);
}

/**
 * Write the digests (or, with check, compare them). Returns { written, stale, problems }. With problems,
 * nothing is written. The comparison is made after commands.format, as the committed files were.
 */
/** Bytes as text with LF line ends: a Windows checkout (core.autocrlf) holds a digest with CRLF, and that is not stale. */
const lf = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');

export function digest(root, config, template, { check = false } = {}) {
  const { digests, problems } = renderDigests(root, config, template);
  if (problems.length) return { written: [], stale: [], problems };
  const written = [];
  const stale = [];
  for (const { file, text } of Object.values(digests)) {
    const abs = path.join(root, file);
    const had = existsSync(abs) ? readFileSync(abs) : null;
    if (!config.commands.format) {
      if (had !== null && lf(had) === lf(Buffer.from(text))) continue;
      if (check) stale.push(file);
      else {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, text);
        written.push(file);
      }
      continue;
    }
    // With a formatter, the generated text is what the formatter makes of it, so it is written and formatted
    // in place; a check puts the committed bytes back afterwards.
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    const restore = () => (had === null ? rmSync(abs, { force: true }) : writeFileSync(abs, had));
    let formatted;
    try {
      format(root, config, [file]);
      formatted = readFileSync(abs);
    } catch (err) {
      restore();
      throw err;
    }
    if (check) restore();
    if (had !== null && lf(had) === lf(formatted)) {
      if (!check) restore();
      continue;
    }
    if (check) stale.push(file);
    else written.push(file);
  }
  return { written, stale, problems };
}
