#!/usr/bin/env node
// Summarise Claude Code session transcripts for docs/measurements.md: one line for the session and one per subagent.
// usage: node docs/measurements-transcripts.mjs <session>.jsonl [...]
// A transcript is ~/.claude/projects/<cwd>/<session>.jsonl; its subagents are in <session>/subagents/.
// Context is input + cache-creation + cache-read tokens of an API call; calls are counted once by message id.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const entries = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

function summarise(es, { sidechain }) {
  const calls = new Map();
  for (const e of es) if (e.type === 'assistant' && Boolean(e.isSidechain) === sidechain) calls.set(e.message.id, e.message.usage);
  const us = [...calls.values()];
  if (!us.length) return null;
  const ctx = (u) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const ts = es.map((e) => e.timestamp).filter(Boolean).sort();
  return {
    calls: us.length,
    firstContext: ctx(us[0]),
    peakContext: Math.max(...us.map(ctx)),
    outputTokens: us.reduce((s, u) => s + (u.output_tokens ?? 0), 0),
    wallSeconds: Math.round((Date.parse(ts.at(-1)) - Date.parse(ts[0])) / 1000),
  };
}

for (const file of process.argv.slice(2)) {
  const session = path.basename(file, '.jsonl');
  console.log(JSON.stringify({ session, ...summarise(entries(file), { sidechain: false }) }));
  const dir = path.join(path.dirname(file), session, 'subagents');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
    const es = entries(path.join(dir, f));
    const metaFile = path.join(dir, f.replace(/\.jsonl$/, '.meta.json'));
    const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
    // What Claude Code put in the subagent's context before its first call: memory files and the skill listing.
    const memory = es.filter((e) => e.attachment?.type === 'instructions').flatMap((e) => e.attachment.files.map((m) => `${m.path}:${m.content.length}`));
    const later = es.filter((e) => e.attachment?.type === 'nested_memory').map((e) => `${e.attachment.path}:${e.attachment.content.content.length}`);
    const listing = es.find((e) => e.attachment?.type === 'skill_listing')?.attachment.content.length ?? 0;
    const system = es.find((e) => e.attachment?.type === 'prompt_snapshot')?.attachment.systemPrompt.join('').length ?? null;
    console.log(JSON.stringify({ agent: meta.agentType, description: meta.description, ...summarise(es, { sidechain: true }), systemChars: system, skillListingChars: listing, memory, loadedLater: later }));
  }
}
