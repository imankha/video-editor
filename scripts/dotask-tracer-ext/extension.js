// dotask tracer: THROWAWAY observation extension. It answers, by observation, what a real
// "auto-continue after STAGE_DONE commit" extension could do inside a dotask container window.
// Every record is one JSON line in /workspace/.dotask-tracer.log; the report is rebuilt from that
// log, so it survives window reloads. See README.md for install and the probe walkthrough.
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WS = fs.existsSync('/workspace') ? '/workspace' : os.tmpdir();
const LOG = path.join(WS, '.dotask-tracer.log');
const REPORT = path.join(WS, '.dotask-tracer-report.md');
const REAL_STATUS = path.join(WS, '.dotask-status');
const TRACER_STATUS = path.join(WS, '.dotask-tracer-status');
const CLAUDE_ID = 'anthropic.claude-code';
const SELF_ID = 'reelballers-local.dotask-tracer';
const PING = 'tracer ping: reply with the single word ok';
const COMMIT_RE = /STAGE_DONE T\d+ commit/;

let out;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safe(v, depth = 0) {
  if (v === undefined) return '<undefined>';
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? '<function>' : v;
  if (depth > 3) return '<' + (v.constructor && v.constructor.name) + '>';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => safe(x, depth + 1));
  const o = { __type: v.constructor && v.constructor.name };
  for (const k of Object.keys(v).slice(0, 40)) {
    try { o[k] = safe(v[k], depth + 1); } catch (e) { o[k] = '<throws ' + e + '>'; }
  }
  return o;
}

function log(kind, data) {
  const rec = Object.assign({ ts: new Date().toISOString(), tms: Date.now(), kind }, data);
  const line = JSON.stringify(rec);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) { /* the OutputChannel still has it */ }
  if (out) out.appendLine(line);
  return rec;
}

function describeInput(i) {
  if (!i) return null;
  return {
    type: i.constructor && i.constructor.name,
    viewType: i.viewType,
    uri: i.uri ? i.uri.toString() : undefined,
  };
}

function snapshot() {
  const tabs = [];
  for (const g of vscode.window.tabGroups.all) {
    for (const t of g.tabs) {
      tabs.push({ col: g.viewColumn, label: t.label, active: t.isActive, groupActive: g.isActive, input: describeInput(t.input) });
    }
  }
  const at = vscode.window.tabGroups.activeTabGroup.activeTab;
  return {
    tabs,
    activeTab: at ? at.label : null,
    activeTabInput: at ? describeInput(at.input) : null,
    windowFocused: vscode.window.state.focused,
    activeTextEditor: vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri.toString() : null,
    activeTerminal: vscode.window.activeTerminal ? vscode.window.activeTerminal.name : null,
    terminals: vscode.window.terminals.map((t) => t.name),
  };
}

// One sub-step inside a probe: run, record result or thrown error.
async function step(steps, name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    steps.push({ name, ok: true, ms: Date.now() - t0, result: safe(r) });
    return r;
  } catch (e) {
    steps.push({ name, ok: false, ms: Date.now() - t0, error: String((e && e.message) || e) });
    return undefined;
  }
}

// Ask the human (modal, so it cannot be missed); the answer is logged as evidence.
async function ask(probeId, question, options) {
  const pick = await vscode.window.showInformationMessage(question, { modal: true }, ...options);
  log('human_answer', { probe: probeId, question, answer: pick || '<dismissed>' });
  return pick;
}

async function instruct(probeId, text) {
  const pick = await vscode.window.showInformationMessage(text, { modal: true }, 'Continue');
  log('instruction', { probe: probeId, text, proceeded: pick === 'Continue' });
  return pick === 'Continue';
}

async function probe(id, title, fn) {
  const before = snapshot();
  log('probe_start', { probe: id, title, before });
  const steps = [];
  let error;
  try { await fn(steps); } catch (e) { error = String((e && e.stack) || e); }
  await sleep(1500);
  log('probe_end', { probe: id, title, steps, error, after: snapshot() });
  vscode.window.setStatusBarMessage('dotask tracer: ' + id + ' done', 4000);
}

// ---------- environment ----------

function claudeManifest(ext) {
  const c = (ext && ext.packageJSON && ext.packageJSON.contributes) || {};
  const cfg = Array.isArray(c.configuration) ? c.configuration : [c.configuration || {}];
  const config = {};
  for (const s of cfg) {
    for (const [k, v] of Object.entries((s && s.properties) || {})) config[k] = { type: v.type, default: v.default, description: v.description || v.markdownDescription };
  }
  return {
    activationEvents: ext.packageJSON.activationEvents,
    extensionKindManifest: ext.packageJSON.extensionKind,
    contributesKeys: Object.keys(c),
    uriHandler: c.uriHandler || '<not declared in contributes (registered in code)>',
    commands: (c.commands || []).map((x) => ({ command: x.command, title: x.title, enablement: x.enablement })),
    keybindings: c.keybindings || [],
    menus: c.menus || {},
    configuration: config,
  };
}

async function envFacts() {
  const self = vscode.extensions.getExtension(SELF_ID);
  const claude = vscode.extensions.getExtension(CLAUDE_ID);
  const kindName = (k) => (k === vscode.ExtensionKind.UI ? 'UI' : k === vscode.ExtensionKind.Workspace ? 'Workspace' : String(k));
  log('env', {
    vscodeVersion: vscode.version,
    remoteName: vscode.env.remoteName || null,
    uiKind: vscode.env.uiKind === vscode.UIKind.Desktop ? 'Desktop' : 'Web',
    appHost: vscode.env.appHost,
    selfExtensionKind: self ? kindName(self.extensionKind) : '<self not found>',
    hostSide: self && self.extensionKind === vscode.ExtensionKind.Workspace ? 'workspace host' : 'UI host',
    platform: process.platform,
    hostname: os.hostname(),
    user: os.userInfo().username,
    dockerenv: fs.existsSync('/.dockerenv'),
    workspaceDir: WS,
    workspaceFolders: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.toString()),
    realStatusExists: fs.existsSync(REAL_STATUS),
    claudeFound: !!claude,
    claudeVersion: claude ? claude.packageJSON.version : null,
    claudeExtensionKind: claude ? kindName(claude.extensionKind) : null,
    claudeIsActive: claude ? claude.isActive : null,
    claudeExportsKeys: claude && claude.isActive && claude.exports ? Object.keys(claude.exports) : null,
  });
  const all = await vscode.commands.getCommands(true);
  log('claude_commands', { commands: all.filter((c) => /claude/i.test(c)).sort() });
  if (claude) log('claude_manifest', claudeManifest(claude));
}

// ---------- status-file watcher (fs.watch on the dir + 500ms poll fallback) ----------

function watchStatus(file, label, disposables) {
  const st = { offset: 0, partial: '' };
  try {
    st.offset = fs.statSync(file).size;
  } catch (e) { /* not there yet: every line will be new */ }
  log('watch_start', { label, file, exists: fs.existsSync(file), startOffset: st.offset });

  const check = (source) => {
    let s;
    try { s = fs.statSync(file); } catch (e) { return; }
    if (s.size < st.offset) { log('status_truncated', { label, file, was: st.offset, now: s.size }); st.offset = 0; st.partial = ''; }
    if (s.size === st.offset) return;
    const len = s.size - st.offset;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, len, st.offset); } finally { fs.closeSync(fd); }
    st.offset = s.size;
    const lines = (st.partial + buf.toString('utf8')).split('\n');
    st.partial = lines.pop();
    const now = Date.now();
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim()) continue;
      const m = line.match(/tracer_ms=(\d+)/);
      log('status_line', {
        label, file, source, line,
        isCommit: COMMIT_RE.test(line),
        mtimeLatencyMs: Math.round(now - s.mtimeMs),
        writerLatencyMs: m ? now - Number(m[1]) : null,
      });
    }
  };

  try {
    const w = fs.watch(path.dirname(file), (evt, fname) => {
      if (!fname || fname === path.basename(file)) check('fs.watch:' + evt);
    });
    w.on('error', (e) => log('watch_error', { label, error: String(e) }));
    disposables.push({ dispose: () => w.close() });
  } catch (e) {
    log('watch_error', { label, error: String(e) });
  }
  const t = setInterval(() => check('poll'), 500);
  disposables.push({ dispose: () => clearInterval(t) });
}

// ---------- probes ----------

const exec = (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args);

async function claudeTerminalLaunches(steps, ms) {
  // Record terminals opened + shell-integration command lines for ms milliseconds.
  const seen = [];
  const subs = [vscode.window.onDidOpenTerminal((t) => seen.push({ ev: 'open', name: t.name, at: Date.now() }))];
  if (vscode.window.onDidStartTerminalShellExecution) {
    subs.push(vscode.window.onDidStartTerminalShellExecution((e) => seen.push({ ev: 'exec', name: e.terminal.name, cmd: e.execution.commandLine && e.execution.commandLine.value, at: Date.now() })));
  }
  await sleep(ms);
  subs.forEach((s) => s.dispose());
  steps.push({ name: 'terminal events', ok: true, result: seen });
}

const PROBES = {
  a_newConvNoArgs: () => probe('a', 'newConversation no args', async (steps) => {
    await step(steps, 'claude-vscode.newConversation()', () => exec('claude-vscode.newConversation'));
    await sleep(1500);
    await ask('a', 'Probe a: did a NEW Claude conversation appear in THIS window?', ['Yes, new conversation here', 'Panel focused but same conversation', 'Nothing visible', 'Something in another window']);
  }),

  b_newConvArgs: () => probe('b', 'newConversation with args', async (steps) => {
    await step(steps, 'newConversation("tracer string arg")', () => exec('claude-vscode.newConversation', 'tracer string arg'));
    await sleep(1500);
    await ask('b', 'Probe b1 (string arg): new conversation? Is the text "tracer string arg" in the input?', ['New conv, text prefilled', 'New conv, empty input', 'Nothing happened']);
    await step(steps, 'newConversation({prompt})', () => exec('claude-vscode.newConversation', { prompt: 'tracer object arg' }));
    await sleep(1500);
    await ask('b', 'Probe b2 (object {prompt}): new conversation? Is "tracer object arg" in the input?', ['New conv, text prefilled', 'New conv, empty input', 'Nothing happened']);
  }),

  c_focusOpen: () => probe('c', 'focus / sidebar.open / editor.open', async (steps) => {
    await step(steps, 'claude-vscode.focus', () => exec('claude-vscode.focus'));
    await sleep(800);
    steps.push({ name: 'snapshot after focus', ok: true, result: snapshot() });
    await ask('c', 'Probe c1 (focus): is the cursor blinking in a Claude input box in this window?', ['Yes', 'Panel visible, no cursor', 'No Claude panel visible']);
    await step(steps, 'claude-vscode.sidebar.open', () => exec('claude-vscode.sidebar.open'));
    await sleep(800);
    steps.push({ name: 'snapshot after sidebar.open', ok: true, result: snapshot() });
    await step(steps, 'claude-vscode.editor.open', () => exec('claude-vscode.editor.open'));
    await sleep(800);
    steps.push({ name: 'snapshot after editor.open', ok: true, result: snapshot() });
    await ask('c', 'Probe c2/c3 (sidebar.open then editor.open): what is visible now?', ['Sidebar + new editor tab', 'Only sidebar', 'Only editor tab', 'Nothing new']);
  }),

  d_openExternal: () => probe('d', 'openExternal claude /open URI and self URI', async (steps) => {
    const ok = await instruct('d', 'Probe d: have ANOTHER VS Code window open (e.g. the host repo) and click it LAST before coming back here, so we see which window the URI targets. Then Continue.');
    if (!ok) return;
    const selfNonce = String(Date.now());
    await step(steps, 'openExternal(vscode://' + SELF_ID + '/selftest)', () => vscode.env.openExternal(vscode.Uri.parse('vscode://' + SELF_ID + '/selftest?n=' + selfNonce)));
    await sleep(3000);
    steps.push({ name: 'self-URI nonce (look for uri_received with this n)', ok: true, result: selfNonce });
    await step(steps, 'openExternal(vscode://anthropic.claude-code/open?prompt=tracer%20test)', () => vscode.env.openExternal(vscode.Uri.parse('vscode://anthropic.claude-code/open?prompt=tracer%20test')));
    await sleep(4000);
    await ask('d', 'Probe d: did a confirmation dialog appear? (If yes, note its exact wording + whether it offered "always allow"; tell Claude in chat.)', ['Yes, a confirmation', 'No confirmation']);
    await ask('d', 'Probe d: where did "tracer test" land?', ['New conv in THIS window', 'In the OTHER window', 'Nowhere']);
  }),

  e_typeCommand: () => probe('e', 'type command into Claude panel', async (steps) => {
    await step(steps, 'claude-vscode.focus', () => exec('claude-vscode.focus'));
    await sleep(800);
    await step(steps, 'type {text}', () => exec('type', { text: 'tracer type test' }));
    await sleep(800);
    await ask('e', 'Probe e: did "tracer type test" appear in the Claude input (or anywhere else)?', ['In the Claude input', 'In a text editor', 'Nowhere']);
  }),

  f_submitAttempts: () => probe('f', 'prefill + submit attempts', async (steps) => {
    const claude = vscode.extensions.getExtension(CLAUDE_ID);
    steps.push({ name: 'contributed keybindings', ok: true, result: claude ? claudeManifest(claude).keybindings : null });
    await step(steps, 'primaryEditor.open(undefined, PING)', () => exec('claude-vscode.primaryEditor.open', undefined, PING));
    await sleep(2500);
    const pre = await ask('f', 'Probe f1: is "' + PING + '" prefilled in a Claude input in this window (not sent yet)?', ['Prefilled, not sent', 'Already sent', 'Not there']);
    await step(steps, 'claude-vscode.focus', () => exec('claude-vscode.focus'));
    await sleep(600);
    await step(steps, 'type {text: "\\n"}', () => exec('type', { text: '\n' }));
    await sleep(3000);
    await ask('f', 'Probe f2 (type newline): was the ping SUBMITTED (Claude starts replying)?', ['Submitted', 'Not submitted']);
    if (pre === 'Not there') return;
    await vscode.env.clipboard.writeText(PING + ' (paste)');
    await step(steps, 'claude-vscode.focus', () => exec('claude-vscode.focus'));
    await sleep(600);
    await step(steps, 'editor.action.clipboardPasteAction', () => exec('editor.action.clipboardPasteAction'));
    await sleep(800);
    await ask('f', 'Probe f3 (clipboard + paste command): did "(paste)" text appear in the Claude input?', ['Yes, pasted', 'No']);
  }),

  g_simulateCommit: () => probe('g', 'simulate commit line', async (steps) => {
    const stamp = new Date().toISOString().slice(0, 16);
    const line = stamp + ' STAGE_DONE T0 commit "tracer" tracer_ms=' + Date.now() + '\n';
    await step(steps, 'append to ' + TRACER_STATUS, () => fs.appendFileSync(TRACER_STATUS, line));
    await sleep(2000);
  }),

  h_directPrefill: () => probe('h', 'primaryEditor.open / editor.open with prompt, no URI', async (steps) => {
    await step(steps, 'claude-vscode.primaryEditor.open(undefined, "tracer h1 ...")', () => exec('claude-vscode.primaryEditor.open', undefined, 'tracer h1: reply with the single word ok'));
    await sleep(2500);
    await ask('h', 'Probe h1 (primaryEditor.open, no URI): new conversation in THIS window with "tracer h1" prefilled? Any confirmation dialog?', ['New conv + prefilled, no dialog', 'Prefilled into EXISTING conv', 'Dialog appeared', 'Nothing']);
    await step(steps, 'claude-vscode.editor.open(undefined, "tracer h2 ...")', () => exec('claude-vscode.editor.open', undefined, 'tracer h2: reply with the single word ok'));
    await sleep(2500);
    await ask('h', 'Probe h2 (editor.open, no URI): new conversation with "tracer h2" prefilled?', ['New conv + prefilled', 'Prefilled into EXISTING conv', 'Nothing']);
  }),

  i_terminalOpen: () => probe('i', 'terminal.open with prompt (claude CLI positional prompt)', async (steps) => {
    const launches = claudeTerminalLaunches(steps, 6000);
    await step(steps, 'claude-vscode.terminal.open(PING, [], "bottom")', () => exec('claude-vscode.terminal.open', PING, [], 'bottom'));
    await launches;
    await sleep(15000);
    await ask('i', 'Probe i: a terminal running claude opened. Did it ANSWER the ping ("ok") with zero keypresses? Any trust/permission prompt?', ['Answered, no prompt', 'Prompt blocked it (tell Claude the wording)', 'Prompt sat in input, not sent', 'No terminal / error']);
  }),

  j_terminalResend: () => probe('j', 'sendText /clear + prompt into existing Claude terminal', async (steps) => {
    const t = vscode.window.terminals.slice().reverse().find((x) => /claude/i.test(x.name));
    steps.push({ name: 'target terminal', ok: !!t, result: t ? t.name : '<no Claude terminal; run probe i first>' });
    if (!t) return;
    t.show(true);
    await step(steps, 'sendText("/clear") + CR', async () => { t.sendText('/clear', false); await sleep(400); t.sendText('\r', false); });
    await sleep(3000);
    await step(steps, 'sendText("tracer j ...") + CR', async () => { t.sendText('tracer j: reply with the single word ok', false); await sleep(400); t.sendText('\r', false); });
    await sleep(15000);
    await ask('j', 'Probe j: was the terminal conversation CLEARED and then "tracer j" answered, with no keypress from you?', ['Cleared + answered', 'Answered but not cleared', 'Text typed but not submitted', 'Nothing']);
  }),

  k_inflight: () => probe('k', 'disturbance of an in-flight conversation', async (steps) => {
    const ok = await instruct('k', 'Probe k: in a THROWAWAY Claude panel conversation in this window, send "count slowly from 1 to 300, one number per line". While it is streaming, click Continue.');
    if (!ok) return;
    await step(steps, 'claude-vscode.newConversation()', () => exec('claude-vscode.newConversation'));
    await sleep(1500);
    await step(steps, 'primaryEditor.open(undefined, "tracer k ...")', () => exec('claude-vscode.primaryEditor.open', undefined, 'tracer k: reply ok'));
    await sleep(3000);
    await ask('k', 'Probe k: is the counting conversation still streaming / intact (switch back to it to check)?', ['Still streaming, intact', 'Interrupted / stopped', 'Its input got overwritten', 'Lost']);
  }),
};

// ---------- report (rebuilt from the JSONL log) ----------

function readLog() {
  try {
    return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}

function stats(nums) {
  if (!nums.length) return 'n/a';
  const s = nums.slice().sort((a, b) => a - b);
  return 'n=' + s.length + ' min=' + s[0] + ' median=' + s[Math.floor(s.length / 2)] + ' max=' + s[s.length - 1];
}

function buildReport() {
  const recs = readLog();
  const last = (k) => recs.filter((r) => r.kind === k).pop();
  const env = last('env') || {};
  const cmds = last('claude_commands') || {};
  const man = last('claude_manifest') || {};
  const L = [];
  L.push('# dotask tracer report', '', 'Generated ' + new Date().toISOString() + ' from ' + LOG + ' (' + recs.length + ' records). Observed facts only; inference is added by hand below the marker.', '');
  L.push('## Environment (observed)', '', '```json', JSON.stringify(env, null, 2), '```', '');
  L.push('## Claude commands registered at runtime', '', (cmds.commands || []).map((c) => '- `' + c + '`').join('\n') || '(none logged)', '');
  L.push('## Claude keybindings (manifest)', '', '```json', JSON.stringify(man.keybindings || [], null, 1), '```', '');
  L.push('Manifest uriHandler: ' + JSON.stringify(man.uriHandler) + '. Activation: ' + JSON.stringify(man.activationEvents), '');

  L.push('## Status-file detection (observed)', '');
  for (const label of ['real', 'tracer']) {
    const lines = recs.filter((r) => r.kind === 'status_line' && r.label === label);
    const bySrc = {};
    lines.forEach((r) => { const k = r.source.split(':')[0]; bySrc[k] = (bySrc[k] || 0) + 1; });
    L.push('- **' + label + '** lines detected: ' + lines.length + ', by first detector: ' + JSON.stringify(bySrc) +
      '; writer latency ms: ' + stats(lines.filter((r) => r.writerLatencyMs != null).map((r) => r.writerLatencyMs)) +
      '; mtime latency ms: ' + stats(lines.map((r) => r.mtimeLatencyMs)) + '; commit lines: ' + lines.filter((r) => r.isCommit).length);
  }
  const werr = recs.filter((r) => r.kind === 'watch_error');
  if (werr.length) L.push('- watch errors: ' + werr.map((r) => r.label + ': ' + r.error).join('; '));
  L.push('');

  const uris = recs.filter((r) => r.kind === 'uri_received');
  L.push('## URIs received by this window\'s handler', '', uris.length ? uris.map((r) => '- ' + r.ts + ' `' + r.uri + '`').join('\n') : '(none)', '');

  L.push('## Probes (observed)', '');
  for (const end of recs.filter((r) => r.kind === 'probe_end')) {
    L.push('### ' + end.probe + '. ' + end.title + ' (' + end.ts + ')', '');
    for (const s of end.steps || []) {
      const res = s.ok ? 'ok ' + JSON.stringify(s.result).slice(0, 300) : 'THREW: ' + s.error;
      L.push('- `' + s.name + '`: ' + res);
    }
    if (end.error) L.push('- probe error: ' + end.error);
    const start = recs.filter((r) => r.kind === 'probe_start' && r.probe === end.probe && r.tms <= end.tms).pop();
    if (start) {
      const lbl = (sn) => sn.tabs.map((t) => t.label + (t.input && t.input.viewType ? '[' + t.input.viewType + ']' : '')).join(', ');
      L.push('- tabs before: ' + lbl(start.before) + ' | active: ' + start.before.activeTab + ' | focused: ' + start.before.windowFocused);
      L.push('- tabs after: ' + lbl(end.after) + ' | active: ' + end.after.activeTab + ' | focused: ' + end.after.windowFocused + ' | terminals: ' + end.after.terminals.join(', '));
    }
    const answers = recs.filter((r) => r.kind === 'human_answer' && r.probe === end.probe && (!start || r.tms >= start.tms) && r.tms <= end.tms);
    for (const a of answers) L.push('- human: "' + a.question + '" -> **' + a.answer + '**');
    L.push('');
  }
  L.push('<!-- INFERENCE BELOW (hand-written) -->', '');
  fs.writeFileSync(REPORT, L.join('\n'));
  return REPORT;
}

// ---------- activation ----------

function activate(context) {
  out = vscode.window.createOutputChannel('dotask tracer');
  context.subscriptions.push(out);
  log('activate', { workspaceDir: WS, pid: process.pid });

  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri(uri) { log('uri_received', { uri: uri.toString(), path: uri.path, query: uri.query }); },
  }));

  const disposables = [];
  watchStatus(REAL_STATUS, 'real', disposables);
  watchStatus(TRACER_STATUS, 'tracer', disposables);
  context.subscriptions.push(...disposables);

  context.subscriptions.push(vscode.commands.registerCommand('dotaskTracer.envFacts', envFacts));
  for (const [name, fn] of Object.entries(PROBES)) {
    context.subscriptions.push(vscode.commands.registerCommand('dotaskTracer.' + name, fn));
  }
  context.subscriptions.push(vscode.commands.registerCommand('dotaskTracer.report', async () => {
    const p = buildReport();
    log('report_written', { path: p });
    const doc = await vscode.workspace.openTextDocument(p);
    await vscode.window.showTextDocument(doc, { preview: false });
  }));

  envFacts().catch((e) => log('env_error', { error: String(e) }));
  // Claude activates on onStartupFinished too; re-check once it has had time to export anything.
  setTimeout(() => {
    const c = vscode.extensions.getExtension(CLAUDE_ID);
    log('claude_late_check', { found: !!c, isActive: c ? c.isActive : null, exportsKeys: c && c.isActive && c.exports ? Object.keys(c.exports) : null });
  }, 10000);
}

function deactivate() { log('deactivate', {}); }

module.exports = { activate, deactivate };
