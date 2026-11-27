// The ledger's three files: rows read and written, and an older ledger split into them (docs/design.md §4.7, §13.5).

export const LEDGER_HEADER = '| D | Title | Status |';
export const SHIPPED_HEADER = '| D | Title | Shipped | Pull request |';
export const STATUSES = ['planned', 'in progress', 'shipped'];

const SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;
const unlink = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
const cell = (s) => String(s).replace(/\|/g, '\\|');

/** Split a table line into its cells, honouring `\|`. */
export function cells(line) {
  const out = [];
  let cur = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (body[i] === '|') {
      out.push(cur.trim());
      cur = '';
    } else cur += body[i];
  }
  out.push(cur.trim());
  return out;
}

const deliverable = (s) => /\bD(\d+)\b/.exec(unlink(s))?.[1];
const linkIn = (s) => /\]\(([^)\s]+)\)/.exec(s)?.[1] ?? null;

/** A status as the ledger writes it, or null when the text names none it knows. */
export function normalizeStatus(s) {
  // The cell's first word decides; anything after it ("shipped 2026-10-01", "planned (after D2)") is detail.
  const t = unlink(s).toLowerCase().replace(/^[^a-z]+/, '');
  if (/^in[ -]?progress\b/.test(t)) return 'in progress';
  if (/^(shipped|done|merged)\b/.test(t)) return 'shipped';
  if (/^(planned|scoped|next|todo)\b/.test(t)) return 'planned';
  return null;
}

/** The rows of a Slipway ledger table (the first table whose header is `| D | Title | Status |`). */
export function readRows(text, header = LEDGER_HEADER) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === header);
  if (start < 0) return [];
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const c = cells(lines[i]);
    const n = deliverable(c[0]);
    if (n === undefined) continue;
    rows.push({ n: Number(n), title: c[1] ?? '', status: c[2] ?? '', link: linkIn(c[0]), line: i, cells: c });
  }
  return rows;
}

const rowLine = ({ n, title, status, link }) => `| ${link ? `[D${n}](${link})` : `D${n}`} | ${cell(title)} | ${status} |`;

/** Add a row, or replace the row for the same deliverable. Rows stay in number order. */
export function setRow(text, row, header = LEDGER_HEADER, render = rowLine) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === header);
  if (start < 0) throw new Error(`the ledger has no "${header}" table`);
  let end = start + 2;
  while (end < lines.length && lines[end].trim().startsWith('|')) end++;
  const body = lines.slice(start + 2, end).filter((l) => Number(deliverable(cells(l)[0])) !== row.n);
  body.push(render(row));
  body.sort((a, b) => Number(deliverable(cells(a)[0]) ?? 0) - Number(deliverable(cells(b)[0]) ?? 0));
  lines.splice(start + 2, end - start - 2, ...body);
  return lines.join('\n');
}

/** Remove a deliverable's row. */
export function removeRow(text, n, header = LEDGER_HEADER) {
  const rows = readRows(text, header).filter((r) => r.n === n);
  const lines = text.split('\n');
  for (const r of rows.reverse()) lines.splice(r.line, 1);
  return lines.join('\n');
}

export const shippedLine = ({ n, title, date, pr, link }) =>
  `| ${link ? `[D${n}](${link})` : `D${n}`} | ${cell(title)} | ${date ?? ''} | ${pr ?? ''} |`;

/**
 * Split a ledger in another shape into the three files' parts (§13.5 step 5). Every table with a deliverable
 * column and a status column is read as rows; everything else is the build plan and goes to ROADMAP.md whole.
 * Returns { open, shipped, rest, unread } — open and shipped rows, the remaining text, and rows whose status
 * could not be read (kept in the ledger as planned, and reported).
 */
export function splitLegacy(text) {
  const lines = text.split(/\r?\n/);
  const open = [];
  const shipped = [];
  const unread = [];
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i].trim().startsWith('|') && SEPARATOR.test(lines[i + 1]?.trim() ?? ''))) {
      keep.push(lines[i]);
      continue;
    }
    const head = cells(lines[i]).map((h) => unlink(h).toLowerCase());
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith('|')) end++;
    const body = lines.slice(i + 2, end).map(cells);
    const statusCol = head.findIndex((h) => /status|state/.test(h));
    let dCol = head.findIndex((h) => /^(d|#|id|no\.?|deliverable)$/.test(h));
    if (dCol < 0) dCol = head.findIndex((_, c) => body.length && body.every((r) => deliverable(r[c] ?? '') !== undefined));
    if (statusCol < 0 || dCol < 0) {
      keep.push(...lines.slice(i, end));
      i = end - 1;
      continue;
    }
    let titleCol = head.findIndex((h, c) => c !== dCol && c !== statusCol && /title|name|what/.test(h));
    if (titleCol < 0) titleCol = [...head.keys()].find((c) => c !== dCol && c !== statusCol) ?? -1;
    for (const r of body) {
      const n = deliverable(r[dCol] ?? '');
      if (n === undefined) continue;
      const row = {
        n: Number(n),
        title: unlink(titleCol >= 0 ? (r[titleCol] ?? '') : ''),
        link: linkIn(r[dCol] ?? '') ?? (titleCol >= 0 ? linkIn(r[titleCol] ?? '') : null),
      };
      const status = normalizeStatus(r[statusCol] ?? '');
      if (status === 'shipped') shipped.push({ ...row, date: /\d{4}-\d{2}-\d{2}/.exec(r.join(' '))?.[0] ?? '' });
      else if (status) open.push({ ...row, status });
      else {
        open.push({ ...row, status: 'planned' });
        unread.push(`D${n}: "${r[statusCol] ?? ''}"`);
      }
    }
    i = end - 1;
  }
  const rest = keep
    .join('\n')
    .replace(/^#\s+.*\n?/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { open, shipped, rest, unread };
}

/** Render rows into a template's table: the table header line is followed by its separator, then the rows. */
export function withRows(template, header, rows, render) {
  let text = template;
  for (const r of rows) text = setRow(text, r, header, render);
  return text;
}

export { rowLine };
