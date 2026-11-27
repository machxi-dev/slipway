// The SessionStart hook: where this session stands, in three lines (docs/design.md §3.2).
// It never fails a session: outside a Slipway repository, or on any error, it prints nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { repoRoot } from './git.mjs';
import { findLane } from './lane.mjs';
import { readRows } from './ledger.mjs';

export function orient(cwd) {
  const root = repoRoot(cwd);
  if (!root) return [];
  const config = loadConfig(root);
  const rows = readRows(readFileSync(path.join(root, config.docs.plans, 'README.md'), 'utf8'));
  const open = rows.filter((r) => r.status === 'in progress').map((r) => `D${r.n}`);
  const planned = rows.filter((r) => r.status === 'planned').length;
  const lines = [];
  let lane = null;
  try {
    lane = findLane(root, config);
  } catch {}
  if (lane?.plan) {
    const next = lane.plan.steps.find((s) => !s.built);
    const ci = lane.plan.header.CI ?? '?';
    lines.push(`Slipway: this is lane D${lane.n}, ${lane.plan.title} (CI: ${ci}).`);
    lines.push(next ? `Next step: ${next.k}. ${next.title} — /slipway:build` : 'Every step is built — /slipway:ship closes the lane.');
  } else {
    lines.push(`Slipway: not on a lane. Open lanes: ${open.length ? open.join(', ') : 'none'}.`);
  }
  lines.push(`Planned rows: ${planned}${planned < 2 ? ' — /slipway:plan adds more' : ''}.`);
  return lines;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let cwd = process.cwd();
  try {
    const input = process.stdin.isTTY ? {} : JSON.parse(readFileSync(0, 'utf8') || '{}');
    if (typeof input.cwd === 'string') cwd = input.cwd;
  } catch {}
  try {
    const lines = orient(cwd);
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  } catch {}
  process.exit(0);
}
