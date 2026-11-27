// Prints each Bash tool call and its raw result from a `claude -p --output-format stream-json --verbose` log.
// Usage: node extract.mjs <log.jsonl>
import { readFileSync } from 'node:fs';
const calls = new Map();
for (const line of readFileSync(process.argv[2], 'utf8').split(/\r?\n/)) {
  let m; try { m = JSON.parse(line); } catch { continue; }
  if (m.type === 'system' && m.subtype === 'init') console.log(`# claude_code_version=${m.claude_code_version} cwd=${m.cwd}`);
  for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
    if (b.type === 'tool_use') { calls.set(b.id, b); console.log(`\n$ [${b.name}] ${b.input?.command ?? JSON.stringify(b.input)}`); }
    if (b.type === 'tool_result') {
      const out = Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join('') : String(b.content ?? '');
      console.log(`${b.is_error ? '[is_error] ' : ''}${out}`);
    }
  }
}
