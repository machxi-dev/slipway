// The `slipway` command line: the runner and the plugin's verbs (docs/design.md §3.2, §3.3).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError, loadConfig } from './config.mjs';
import { repoRoot } from './git.mjs';
import { runCommand } from './run.mjs';
import { init, parseInitArgs } from './init.mjs';
import { acceptRecord, newRecord } from './records.mjs';
import { addRow, findLane, nextDeliverable, overlapWarnings, parseLaneArg, setStatus, shipRow, skillsFor } from './lane.mjs';
import { stepText } from './plan.mjs';
import { digest } from './digest.mjs';
import { docsCheck } from './docs-check.mjs';
import { makeWorktree, removeWorktree } from './worktree.mjs';
import { forge } from './forge.mjs';
import { bump, tag } from './release.mjs';

const USAGE = `usage: slipway <verb> [args]

  run <name> [args...]   run a command named in slipway.config.json, from the repository root
  run                    list the command names
  run step-check [--base <ref>]
                         the step check, handed the paths changed since the tree last proved green here
  init [options]         make this repository ready (see /slipway:init)
      --check <cmd>      required for a new config: the command that proves the tree
      --step-check <cmd>, --gate <cmd>   default to --check
      --tag-prefix <p>, --forge github|none, --records|--plans|--digests <dir>, --specs <dir>|none
      --default-branch <b>   default: the remote's HEAD, or the only local branch
      --brownfield       adopt an existing records folder, and split a ledger in another shape (§12, §13.5)
  adr new <title> [--supersedes <n>[,<n>...]]
                         write the next record from the template, proposed, and add it to the index
  adr accept <n>         mark a proposed record accepted and the records it supersedes superseded by it
  lane [D<n>] [--step <k>|next] [--overlap]
                         the lane of this branch (or D<n>): its plan, decisions, worktree and next step;
                         --step prints the plan header and that step's section, with its conventions skills;
                         --overlap warns of open lanes naming the same records
  ledger next | add <title> [--scope <line>] | set D<n> "planned"|"in progress" | ship D<n> [--pr <url>]
                         the ledger's rows: the next number, a planned row, a status, a shipped row
  digest [--check]       write the digests from the accepted records' rules (or say which are stale)
  docs-check             the ledger, plans, decisions, records, digests, specs and byte budgets
  worktree [D<n>]        make the lane's worktree, copy lane.copy into it and run lane.setup
  worktree remove D<n>   remove a shipped lane's worktree and branch
  forge pr-open --title <t> --body-file <f> | pr | comment --body-file <f> | comments | ready | merge
  forge run [--sha <sha>] [--wait] [--log]
                         the forge's pull request and CI run for this branch (github through gh; none locally);
                         comments prints the first line of each comment (under none, the ones recorded locally)
  release bump patch|minor|major
                         bump the version in release.versionFile and release.also
  tag D<n> --head <sha> [--commit <sha>] [--pr <url>] [--title <t>]
                         tag the merge commit of a shipped lane; never moves a tag
  config                 check slipway.config.json and print it with its defaults filled in
  version                print the plugin's version

Commands run through the platform's shell with SLIPWAY_ROOT, SLIPWAY_COMMAND, SLIPWAY_BRANCH,
SLIPWAY_LANE (on a lane branch) and SLIPWAY_PLUGIN_ROOT set. A command listed under locks.tiers
waits for the lock across worktrees; SLIPWAY_LOCK_TIMEOUT (seconds) bounds the wait.`;

class UsageError extends Error {}

function needRepo(cwd) {
  const root = repoRoot(cwd);
  if (!root) throw new UsageError('not inside a git repository');
  return root;
}

/** Split args into options and the rest. `values` take one argument; `flags` take none. */
function options(args, { values = [], flags = [], many = [] } = {}) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.indexOf('=');
    const name = a.startsWith('--') ? (eq > 0 ? a.slice(2, eq) : a.slice(2)) : null;
    if (name !== null && (values.includes(name) || many.includes(name))) {
      let v;
      if (eq > 0) v = a.slice(eq + 1);
      else if (i + 1 < args.length) v = args[++i];
      else throw new UsageError(`--${name} needs a value`);
      if (many.includes(name)) (opts[name] ??= []).push(v);
      else if (name in opts) throw new UsageError(`--${name} is given twice`);
      else opts[name] = v;
    } else if (name !== null && flags.includes(name)) opts[name] = true;
    else if (name !== null) throw new UsageError(`unknown option ${a}`);
    else rest.push(a);
  }
  return { opts, rest };
}

const setup = (cwd) => {
  const root = needRepo(cwd);
  return { root, config: loadConfig(root) };
};

const verbs = {
  async run(args, { cwd, pluginRoot, out, err }) {
    const { root, config } = setup(cwd);
    const [name, ...rest] = args;
    if (!name) {
      for (const [n, c] of Object.entries(config.commands)) {
        out(`${n}${config.locks.tiers.includes(n) ? ' (locked)' : ''}: ${c}`);
      }
      return 0;
    }
    const t = (process.env.SLIPWAY_LOCK_TIMEOUT ?? '').trim();
    const lockTimeoutMs = t === '' ? undefined : Number(t) * 1000;
    if (lockTimeoutMs !== undefined && !(Number.isFinite(lockTimeoutMs) && lockTimeoutMs >= 0)) {
      throw new UsageError('SLIPWAY_LOCK_TIMEOUT must be a number of seconds, 0 or more');
    }
    return runCommand({ root, config, name, args: rest, pluginRoot, log: err, lockTimeoutMs });
  },
  async init(args, { cwd, pluginRoot, out, err }) {
    const root = needRepo(cwd);
    const { actions, warnings } = init(root, pluginRoot, parseInitArgs(args));
    for (const a of actions) out(`${a.action.padEnd(7)} ${a.path}${a.note ? ` (${a.note})` : ''}`);
    for (const w of warnings) err(`slipway init: warning: ${w}`);
    return 0;
  },
  async adr(args, { cwd, pluginRoot, out }) {
    const { root, config } = setup(cwd);
    const dir = path.join(root, config.docs.records);
    const rel = (f) => path.posix.join(config.docs.records, f);
    const [sub, ...more] = args;
    if (sub === 'new') {
      const { opts, rest } = options(more, { many: ['supersedes'] });
      const template = readFileSync(path.join(pluginRoot, 'templates', 'record.md'), 'utf8');
      const supersedes = (opts.supersedes ?? []).flatMap((s) => s.split(',')).filter(Boolean);
      const r = newRecord(dir, template, { title: rest.join(' '), supersedes });
      out(rel(r.file));
      return 0;
    }
    if (sub === 'accept' && more.length === 1) {
      for (const f of acceptRecord(dir, more[0])) out(rel(f));
      return 0;
    }
    throw new UsageError('usage: slipway adr new <title> [--supersedes <n>,...] | slipway adr accept <n>');
  },
  async lane(args, { cwd, out, err }) {
    const { root, config } = setup(cwd);
    const { opts, rest } = options(args, { values: ['step'], flags: ['overlap'] });
    const lane = findLane(root, config, rest[0]);
    if (opts.overlap) {
      for (const w of overlapWarnings(root, config, lane.n)) out(`warning: ${w}`);
      return 0;
    }
    if (!lane.plan) throw new UsageError(`D${lane.n} has no plan at ${lane.planFile}; /slipway:scope writes it`);
    const next = lane.plan.steps.find((s) => !s.built);
    const want = opts.step ?? (lane.k !== null ? String(lane.k) : undefined);
    if (want !== undefined) {
      const k = want === 'next' ? next?.k : Number(want);
      const text = k === undefined ? null : stepText(lane.plan, k);
      if (!text) throw new UsageError(want === 'next' ? `every step of D${lane.n} is built` : `D${lane.n} has no step ${want}`);
      const step = lane.plan.steps.find((s) => s.k === k);
      const skills = skillsFor(config, step.fields.Paths ?? '');
      out(text);
      out('');
      out(`Lane branch: ${lane.branch}${lane.current === lane.branch ? '' : ` (checked out: ${lane.current ?? 'detached'})`}`);
      out(`Decisions file: ${lane.decisionsFile}`);
      out(`Conventions skills: ${skills.length ? skills.join(', ') : 'none'}`);
      return 0;
    }
    const open = lane.decisions.filter((d) => d.open).length;
    const built = lane.plan.steps.filter((s) => s.built).length;
    out(`D${lane.n}. ${lane.plan.title}`);
    out(`status: ${lane.plan.header.Status ?? '?'}; CI: ${lane.plan.header.CI ?? '?'}${lane.plan.header.Release ? `; release: ${lane.plan.header.Release}` : ''}`);
    out(`branch: ${lane.branch}${lane.current === lane.branch ? ' (checked out)' : ''}`);
    out(`plan: ${lane.planFile}`);
    out(`decisions: ${lane.decisionsFile} (${open} open)`);
    out(`worktree: ${lane.worktree}`);
    out(`steps: ${built} of ${lane.plan.steps.length} built${next ? `; next: ${next.k}. ${next.title}` : ''}`);
    return 0;
  },
  async ledger(args, { cwd, out }) {
    const { root, config } = setup(cwd);
    const [sub, ...more] = args;
    if (sub === 'next' && !more.length) {
      out(`D${nextDeliverable(root, config)}`);
      return 0;
    }
    if (sub === 'add') {
      const { opts, rest } = options(more, { values: ['scope'] });
      if (!rest.length) throw new UsageError('ledger add needs a title');
      out(`D${addRow(root, config, rest.join(' '), opts.scope)}`);
      return 0;
    }
    if (sub === 'set' && more.length === 2) {
      for (const f of setStatus(root, config, parseLaneArg(more[0]).n, more[1])) out(`wrote ${f}`);
      return 0;
    }
    if (sub === 'ship') {
      const { opts, rest } = options(more, { values: ['pr', 'date'] });
      if (rest.length !== 1) throw new UsageError('ledger ship needs D<n>');
      for (const f of shipRow(root, config, parseLaneArg(rest[0]).n, { pr: opts.pr, date: opts.date })) out(`wrote ${f}`);
      return 0;
    }
    throw new UsageError('usage: slipway ledger next | add <title> [--scope <line>] | set D<n> <status> | ship D<n> [--pr <url>]');
  },
  async digest(args, { cwd, pluginRoot, out, err }) {
    const { root, config } = setup(cwd);
    const { opts } = options(args, { flags: ['check'] });
    const template = readFileSync(path.join(pluginRoot, 'templates', 'digest.md'), 'utf8');
    const r = digest(root, config, template, { check: opts.check });
    for (const p of r.problems) err(p);
    if (r.problems.length) return 1;
    for (const f of r.stale) out(`stale ${f}`);
    for (const f of r.written) out(`wrote ${f}`);
    return r.stale.length ? 1 : 0;
  },
  async 'docs-check'(args, { cwd, pluginRoot, out, err }) {
    const { root, config } = setup(cwd);
    if (args.length) throw new UsageError('docs-check takes no arguments');
    const { problems, files } = docsCheck(root, config, pluginRoot);
    for (const p of problems) err(p);
    if (problems.length) {
      err(`docs-check: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
      return 1;
    }
    out(`docs-check: ok (${files} files)`);
    return 0;
  },
  async worktree(args, { cwd, pluginRoot, out }) {
    const { root, config } = setup(cwd);
    if (args[0] === 'remove') {
      if (args.length !== 2) throw new UsageError('usage: slipway worktree remove D<n>');
      removeWorktree(root, config, args[1], { log: out });
      return 0;
    }
    if (args.length > 1) throw new UsageError('usage: slipway worktree [D<n>]');
    const w = makeWorktree(root, config, args[0], { pluginRoot, log: out });
    out(w.path);
    if (w.setup !== null && w.setup !== 0) {
      out(`lane.setup exited ${w.setup}`);
      return w.setup;
    }
    return 0;
  },
  async forge(args, { cwd, out }) {
    const { root, config } = setup(cwd);
    const [verb, ...more] = args;
    const { opts } = options(more, { values: ['title', 'body-file', 'sha'], flags: ['wait', 'log'] });
    const bodyFile = opts['body-file'] && path.resolve(cwd, opts['body-file']);
    const r = await forge(root, config, verb, { title: opts.title, bodyFile, sha: opts.sha, wait: opts.wait, log: opts.log });
    for (const l of r.lines) out(l);
    return r.code;
  },
  async release(args, { cwd, out }) {
    const { root, config } = setup(cwd);
    if (args[0] !== 'bump' || args.length !== 2) throw new UsageError('usage: slipway release bump patch|minor|major');
    const r = bump(root, config, args[1]);
    out(`${r.from} -> ${r.to}; tag ${r.tag}`);
    for (const f of r.files) out(`updated ${f}`);
    return 0;
  },
  async tag(args, { cwd, out }) {
    const { root, config } = setup(cwd);
    const { opts, rest } = options(args, { values: ['head', 'commit', 'pr', 'title'] });
    if (rest.length !== 1) throw new UsageError('usage: slipway tag D<n> --head <sha> [--commit <sha>] [--pr <url>] [--title <t>]');
    const n = parseLaneArg(rest[0]).n;
    const t = tag(root, config, n, { head: opts.head, commit: opts.commit, pr: opts.pr, title: opts.title });
    out(`${t.name} ${t.sha}`);
    return 0;
  },
  async config(args, { cwd, out }) {
    out(JSON.stringify(loadConfig(needRepo(cwd)), null, 2));
    return 0;
  },
  async version(args, { pluginRoot, out }) {
    out(JSON.parse(readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version);
    return 0;
  },
};

/** Entry point for bin/slipway. Resolves to the process exit code. */
export async function main(argv, { pluginRoot, cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  const [verb, ...args] = argv;
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    (verb ? out : err)(USAGE);
    return verb ? 0 : 2;
  }
  if (verb === '--version') return main(['version', ...args], { pluginRoot, cwd, out, err });
  const fn = Object.hasOwn(verbs, verb) ? verbs[verb] : undefined;
  if (!fn) {
    err(`slipway: unknown verb "${verb}"\n\n${USAGE}`);
    return 2;
  }
  try {
    return await fn(args, { cwd, pluginRoot, out, err });
  } catch (e) {
    err(`slipway ${verb}: ${e.message}`);
    if (e instanceof UsageError || e instanceof ConfigError || ['EUSAGE', 'ENOENT'].includes(e.code)) return 2;
    return 1;
  }
}
