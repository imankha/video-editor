#!/usr/bin/env node
// Tracer-only Claude Code hook (Stop / UserPromptSubmit). Appends one line per event to the
// tracer status copy so the extension's watcher logs it with latency:
//   <UTC> TURN_END|USER_PROMPT session=<id8> tracer_ms=<ms> tail="<last assistant text, 120 chars>"
// Wired into a THROWAWAY container's ~/.claude/settings.json only.
'use strict';
const fs = require('fs');

const kind = process.argv[2] || 'HOOK';
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let j = {};
  try { j = JSON.parse(input); } catch (e) { /* log the event anyway */ }
  let tail = '';
  if (kind === 'TURN_END' && j.transcript_path) {
    try {
      const lines = fs.readFileSync(j.transcript_path, 'utf8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0 && !tail; i--) {
        const r = JSON.parse(lines[i]);
        if (r.type !== 'assistant') continue;
        const c = r.message && r.message.content;
        const text = Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join(' ') : String(c || '');
        tail = text.replace(/\s+/g, ' ').trim().slice(-120);
      }
    } catch (e) { tail = '<transcript unreadable: ' + e.message + '>'; }
  }
  const sid = String(j.session_id || '?').slice(0, 8);
  const line = new Date().toISOString().slice(0, 16) + ' ' + kind + ' session=' + sid +
    ' tracer_ms=' + Date.now() + ' tail=' + JSON.stringify(tail) + '\n';
  fs.appendFileSync('/workspace/.dotask-tracer-status', line);
});
