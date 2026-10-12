# dotask tracer: findings and recommendation

Run: 2026-10-12, throwaway container `reel-task-tracer`, VS Code 1.140.0 attached-container window,
Claude extension 2.1.296 (panel binary), container CLI `/usr/bin/claude` 2.1.280, Max OAuth login.
Sources: the tracer's JSONL log (raw evidence in the appendix below), the user's answers to the
probe dialogs, and a static read of the Claude extension's `extension.js` / `webview/index.js`.

## Recommendation

**Go headless. Do not build the auto-continue VS Code extension.**

Every GUI route either needs a human keypress (the panel) or can be blocked invisibly by an
interactive screen (the terminal). Headless `claude -p` has neither problem: it answered in 2.4 s
with no screens, and every blocker becomes an exit code, an error result or a missing status line
that a script can read. The existing `HEADLESS_LOOP` (`scripts/dotask_cli.py`) and `task.sh drive`
already implement most of the loop.

Production design:

1. **Deterministic trigger, no model.** Continue only when the run ended AND the last status line is
   `STAGE_DONE T<next> commit` (strict pattern: older workers also wrote `STAGE_DONE step3`,
   `STAGE_DONE review-received` and similar mid-task lines). Each `claude -p` is a fresh context, so
   there is nothing to `/clear`.
2. **Questions are tagged by the worker.** The kickoff tells the worker to write
   `NEEDS_USER T<id> <kind> "<question>"` and end its turn, with `<kind>` from a closed list:
   `design_gate`, `clarify`, `decision`, `human_verify`, `env_blocked`, `stuck`. The loop stops and
   notifies; the answer goes back with `task.sh drive --resume <session-id> "<answer>"`. The relaying
   chat reads only the status line and a short tail, never the transcript.
3. **Blockers are classified, never self-repaired.**
   - Before each run: the existing auth check (`AUTH_DEAD`) plus a config check (no
     `ANTHROPIC_API_KEY`).
   - During: a new no-progress watchdog (status file and transcript unchanged for N minutes) plus a
     wall-clock cap.
   - After: exit code, `is_error` and result text map to `blocked:quota`, `blocked:auth`,
     `blocked:transient`, `blocked:crash`, `blocked:hang`, `untagged` or `blocked:unknown`.
   - Transient errors retry once with backoff. A quota wait may resume after the reset time. All
     other kinds stop and notify with an exact remediation. There is never an automatic re-auth,
     and unknown errors are never retried silently.
4. **One ledger record per run.** The outcome is `auto_continued`, `needs_user:<kind>`,
   `blocked:<kind>` or `untagged`, with the wait time taken from the `UserPromptSubmit` and `Stop`
   hook timestamps. This measures the auto-continue rate and decides headless versus supervisor
   from data. Today's status files cannot measure it: they hold about 40 ad hoc tokens and record
   no questions.
5. **The VS Code window stays optional.** Open it with `bash scripts/task.sh code <slug>` to watch,
   or to continue a session with `claude --resume` when a screenshot is needed.

## Answers to the spec's questions

| Question | Observed | Inference |
|---|---|---|
| Does the extension run in the workspace host inside the container? | Yes. `remoteName=attached-container`, `extensionKind=Workspace`, linux, `/workspace` readable, `/.dockerenv` present. The Claude extension is also Workspace-side and active, and has no exports. | A production extension could read the status file directly. |
| Does `newConversation` start a new conversation here, and does it take a prompt? | Probes a and b: it returned `undefined` and nothing visible happened, with no argument, a string argument or a `{prompt}` argument. | Static read: the handler takes no arguments and only notifies an already-open webview. |
| Can text be prefilled AND submitted without a keypress? | **Panel: prefill yes, submit no.** `primaryEditor.open(undefined, prompt)` and `editor.open(undefined, prompt)` opened a new conversation with the text prefilled and no dialog (probe h). The `type` command reached nothing (e). A typed newline did not submit and the paste command did not paste (f). **Terminal: yes, once the first-run screens are gone.** `terminal.open(prompt, [], "bottom")` ran `claude '<prompt>'`, which auto-submitted and answered (i). `sendText("/clear")` + CR followed by `sendText(prompt)` + CR cleared and answered with no keypress (j). | Static read: the webview's `initialPrompt` path only calls `setInputText`, and no host-to-webview request type submits. The panel cannot be made to send. |
| What does the confirmation say, and can it be permanently allowed? | VS Code's own `openExternal` gate: "Allow 'dotask tracer' extension to open this URI?" with a "Do not ask me again for this extension" checkbox. After it was ticked, the self-URI opened with no dialog. A confirmation still appeared for the Claude `/open` URI, but it flashed and its wording was not captured. | Moot: probe h reaches the same prefill with no URI and no dialog. |
| Does `openExternal` from the container window target this window? | Yes for the self-URI (the nonce `...30283` came back to this window's handler). For the Claude URI, the second run landed in the container window, prefilled. On the first run, the user saw a new conversation in both windows. | Routing is not guaranteed to be exclusive. Avoid URIs. |
| How fast and reliable is detection on the bind mount? | 29 of 29 lines detected, no duplicates. In-container writes: `fs.watch` in 14 to 50 ms. Host writes through the bind mount: `fs.watch` saw none of them, and the 500 ms poll caught all 10 (113 to 770 ms). | The poll fallback is required. |
| Does the Claude panel get focus reliably? | `claude-vscode.focus` put the cursor in the Claude input (c1, corrected by the user: the tracer's own modal dialog had stolen focus). `sidebar.open` opened the secondary sidebar, and `editor.open` added a tab. | Any dialog steals focus from the webview. Static read: `sidebar.open` also persists "sidebar" as the preferred location, so it should never be called programmatically. |
| Is an in-flight conversation disturbed? | **Not tested** (probe k was not run). | Not needed for the headless design. |

## Further observations

- **Terminal first-run screens.** Four separate screens blocked the terminal route before the
  prompt went through: the theme picker, a login screen, the Bypass Permissions warning, and the
  full-screen renderer offer. The panel and `claude -p` showed none of them. Credentials were valid
  throughout: `claude -p` answered from the same config (OAuth `claudeAiOauth`, `max`, no API key).
  The cause is that the container's `.claude.json` lacks the interactive onboarding flags.
- **Turn latency.** The same "reply ok" ping took 2.3 s through headless `claude -p`. Through the
  terminal TUI it took 29.9 s (i) and 32.6 s (j), measured between the hook timestamps.
- **Hooks.** `Stop` and `UserPromptSubmit` fired for both headless and terminal sessions. `/clear`
  produced a new session id. The hook's transcript `tail` was always empty, probably because the
  transcript is not flushed when `Stop` fires, so a production hook should rely on the status file.
  Not tested: hooks for panel conversations (none was submitted).
- **Headless already covers part of this.** `task.sh drive` re-seeds credentials, runs an auth check
  (`AUTH_DEAD`), records `DISPATCH_FAILED` / `ENDED_WITHOUT_STATUS` / `PHASE_VIOLATION`, and caps
  turns at 120. What is missing is the watchdog, the quota/transient classification, `NEEDS_USER`,
  notification, and the ledger.

---

# Appendix: observed facts (generated by "dotask tracer: dump report" from the JSONL log)


Generated 2026-10-12T21:51:29.149Z from C:\work\tasks\tracer\.dotask-tracer.log (112 records). Observed facts only; inference is added by hand below the marker.

### Environment (observed)

```json
{
  "ts": "2026-10-12T21:22:01.903Z",
  "tms": 1791840121903,
  "kind": "env",
  "vscodeVersion": "1.140.0",
  "remoteName": "attached-container",
  "uiKind": "Desktop",
  "appHost": "desktop",
  "selfExtensionKind": "Workspace",
  "hostSide": "workspace host",
  "platform": "linux",
  "hostname": "111aae78bbbb",
  "user": "dev",
  "dockerenv": true,
  "workspaceDir": "/workspace",
  "workspaceFolders": [
    "file:///workspace"
  ],
  "realStatusExists": true,
  "claudeFound": true,
  "claudeVersion": "2.1.296",
  "claudeExtensionKind": "Workspace",
  "claudeIsActive": false,
  "claudeExportsKeys": null
}
```

### Claude commands registered at runtime

- `agentSessions.filter.toggleExclude:agent-host-claude.agentsessionsviewerfiltersubmenu`
- `claude-code.acceptProposedDiff`
- `claude-code.insertAtMentioned`
- `claude-code.rejectProposedDiff`
- `claude-vscode.acceptProposedDiff`
- `claude-vscode.acceptProposedHunk`
- `claude-vscode.acceptProposedHunkFromBar`
- `claude-vscode.addSessionTabToGroup`
- `claude-vscode.blur`
- `claude-vscode.editor.open`
- `claude-vscode.editor.openLast`
- `claude-vscode.focus`
- `claude-vscode.focusLastMessage`
- `claude-vscode.insertAtMention`
- `claude-vscode.logout`
- `claude-vscode.markSessionUnread`
- `claude-vscode.newConversation`
- `claude-vscode.openWalkthrough`
- `claude-vscode.primaryEditor.open`
- `claude-vscode.rejectProposedDiff`
- `claude-vscode.rejectProposedHunk`
- `claude-vscode.rejectProposedHunkFromBar`
- `claude-vscode.renameSessionTab`
- `claude-vscode.reopenClosedSession`
- `claude-vscode.showLogs`
- `claude-vscode.sidebar.open`
- `claude-vscode.terminal.open`
- `claude-vscode.terminal.open.keyboard`
- `claude-vscode.toggleDictation`
- `claude-vscode.toggleFocusView`
- `claude-vscode.window.open`
- `claudeVSCodeSessionsList.focus`
- `claudeVSCodeSessionsList.open`
- `claudeVSCodeSessionsList.removeView`
- `claudeVSCodeSessionsList.resetViewLocation`
- `claudeVSCodeSessionsList.toggleVisibility`
- `claudeVSCodeSidebar.focus`
- `claudeVSCodeSidebar.open`
- `claudeVSCodeSidebar.resetViewLocation`
- `claudeVSCodeSidebarSecondary.focus`
- `claudeVSCodeSidebarSecondary.open`
- `claudeVSCodeSidebarSecondary.removeView`
- `claudeVSCodeSidebarSecondary.resetViewLocation`
- `claudeVSCodeSidebarSecondary.toggleVisibility`
- `workbench.action.chat.openNewChatSessionInPlace.agent-host-claude`
- `workbench.view.extension.claude-sessions-sidebar`
- `workbench.view.extension.claude-sessions-sidebar.resetViewContainerLocation`
- `workbench.view.extension.claude-sidebar`
- `workbench.view.extension.claude-sidebar-secondary`
- `workbench.view.extension.claude-sidebar-secondary.resetViewContainerLocation`
- `workbench.view.extension.claude-sidebar.resetViewContainerLocation`

### Claude keybindings (manifest)

```json
[
 {
  "command": "claude-vscode.insertAtMention",
  "key": "alt+k",
  "mac": "alt+k",
  "when": "editorTextFocus"
 },
 {
  "command": "claude-vscode.focus",
  "key": "cmd+escape",
  "mac": "cmd+escape",
  "win": "ctrl+escape",
  "linux": "ctrl+escape",
  "when": "!config.claudeCode.useTerminal && editorTextFocus"
 },
 {
  "command": "claude-vscode.blur",
  "key": "cmd+escape",
  "mac": "cmd+escape",
  "win": "ctrl+escape",
  "linux": "ctrl+escape",
  "when": "!config.claudeCode.useTerminal && !editorTextFocus"
 },
 {
  "command": "claude-vscode.editor.open",
  "key": "cmd+shift+escape",
  "mac": "cmd+shift+escape",
  "win": "ctrl+shift+escape",
  "linux": "ctrl+shift+escape",
  "when": "!config.claudeCode.useTerminal"
 },
 {
  "command": "claude-vscode.terminal.open.keyboard",
  "key": "cmd+escape",
  "mac": "cmd+escape",
  "win": "ctrl+escape",
  "linux": "ctrl+escape",
  "when": "config.claudeCode.useTerminal"
 },
 {
  "command": "claude-code.insertAtMentioned",
  "key": "cmd+alt+K",
  "mac": "cmd+alt+K",
  "win": "ctrl+alt+K",
  "linux": "ctrl+alt+K",
  "when": "editorTextFocus"
 },
 {
  "command": "claude-vscode.newConversation",
  "key": "cmd+n",
  "mac": "cmd+n",
  "win": "ctrl+n",
  "linux": "ctrl+n",
  "when": "config.claudeCode.enableNewConversationShortcut && (activeWebviewPanelId == 'claudeVSCodePanel' || (claude-vscode.sideBarActive && !editorFocus && !panelFocus))"
 },
 {
  "command": "claude-vscode.toggleFocusView",
  "key": "ctrl+alt+f",
  "when": "activeWebviewPanelId == 'claudeVSCodePanel' || claude-vscode.sideBarActive"
 },
 {
  "command": "claude-vscode.reopenClosedSession",
  "key": "cmd+shift+t",
  "mac": "cmd+shift+t",
  "win": "ctrl+shift+t",
  "linux": "ctrl+shift+t",
  "when": "config.claudeCode.enableReopenClosedSessionShortcut && claude-vscode.lastClosedWasSession"
 }
]
```

Manifest uriHandler: "<not declared in contributes (registered in code)>". Activation: ["onStartupFinished","onWebviewPanel:claudeVSCodePanel"]

### Status-file detection (observed)

- **real** lines detected: 20, by first detector: {"fs.watch":10,"poll":10}; writer latency ms: n=20 min=16 median=113 max=770; mtime latency ms: n=20 min=-532 median=409 max=769; commit lines: 20
- **tracer** lines detected: 9, by first detector: {"fs.watch":9}; writer latency ms: n=9 min=14 median=20 max=27; mtime latency ms: n=9 min=-569 median=195 max=577; commit lines: 1

### URIs received by this window's handler

- 2026-10-12T21:27:40.651Z `vscode://reelballers-local.dotask-tracer/selftest?n%3D1791840430283`
- 2026-10-12T21:30:26.731Z `vscode://reelballers-local.dotask-tracer/selftest?n%3D1791840626686`

### Probes (observed)

#### a. newConversation no args (2026-10-12T21:24:17.122Z)

- `claude-vscode.newConversation()`: ok "<undefined>"
- tabs before: Welcome | active: Welcome | focused: true
- tabs after: Welcome | active: Welcome | focused: true | terminals: 
- human: "Probe a: did a NEW Claude conversation appear in THIS window?" -> **Nothing visible**

#### b. newConversation with args (2026-10-12T21:24:40.062Z)

- `newConversation("tracer string arg")`: ok "<undefined>"
- `newConversation({prompt})`: ok "<undefined>"
- tabs before: Welcome | active: Welcome | focused: true
- tabs after: Welcome | active: Welcome | focused: true | terminals: 
- human: "Probe b1 (string arg): new conversation? Is the text "tracer string arg" in the input?" -> **Nothing happened**
- human: "Probe b2 (object {prompt}): new conversation? Is "tracer object arg" in the input?" -> **Nothing happened**

#### c. focus / sidebar.open / editor.open (2026-10-12T21:26:30.569Z)

- `claude-vscode.focus`: ok "<undefined>"
- `snapshot after focus`: ok {"tabs":[{"col":1,"label":"Welcome","active":true,"groupActive":false,"input":null},{"col":2,"label":"Claude Code","active":true,"groupActive":true,"input":{"type":"wg","viewType":"mainThreadWebview-claudeVSCodePanel"}}],"activeTab":"Claude Code","activeTabInput":{"type":"wg","viewType":"mainThreadW
- `claude-vscode.sidebar.open`: ok "<undefined>"
- `snapshot after sidebar.open`: ok {"tabs":[{"col":1,"label":"Welcome","active":true,"groupActive":false,"input":null},{"col":2,"label":"Claude Code","active":true,"groupActive":true,"input":{"type":"wg","viewType":"mainThreadWebview-claudeVSCodePanel"}}],"activeTab":"Claude Code","activeTabInput":{"type":"wg","viewType":"mainThreadW
- `claude-vscode.editor.open`: ok "<undefined>"
- `snapshot after editor.open`: ok {"tabs":[{"col":1,"label":"Welcome","active":true,"groupActive":false,"input":null},{"col":2,"label":"Claude Code","active":false,"groupActive":true,"input":{"type":"wg","viewType":"mainThreadWebview-claudeVSCodePanel"}},{"col":2,"label":"Claude Code","active":true,"groupActive":true,"input":{"type"
- tabs before: Welcome | active: Welcome | focused: true
- tabs after: Welcome, Claude Code[mainThreadWebview-claudeVSCodePanel], Claude Code[mainThreadWebview-claudeVSCodePanel] | active: Claude Code | focused: true | terminals: 
- human: "Probe c1 (focus): is the cursor blinking in a Claude input box in this window?" -> **Panel visible, no cursor**
- human: "Probe c2/c3 (sidebar.open then editor.open): what is visible now?" -> **Sidebar + new editor tab**

#### d. openExternal claude /open URI and self URI (2026-10-12T21:29:37.301Z)

- `openExternal(vscode://reelballers-local.dotask-tracer/selftest)`: ok true
- `self-URI nonce (look for uri_received with this n)`: ok "1791840430283"
- `openExternal(vscode://anthropic.claude-code/open?prompt=tracer%20test)`: ok true
- tabs before: Welcome, Claude Code[mainThreadWebview-claudeVSCodePanel] | active: Claude Code | focused: true
- tabs after: Welcome, Claude Code[mainThreadWebview-claudeVSCodePanel] | active: Claude Code | focused: true | terminals: 
- human: "Probe d: did a confirmation dialog appear? (If yes, note its exact wording + whether it offered "always allow"; tell Claude in chat.)" -> **Yes, a confirmation**
- human: "Probe d: where did "tracer test" land?" -> **New conv in THIS window**

#### d. openExternal claude /open URI and self URI (2026-10-12T21:30:35.915Z)

- `openExternal(vscode://reelballers-local.dotask-tracer/selftest)`: ok true
- `self-URI nonce (look for uri_received with this n)`: ok "1791840626686"
- `openExternal(vscode://anthropic.claude-code/open?prompt=tracer%20test)`: ok true
- tabs before:  | active: null | focused: true
- tabs after: Claude Code[mainThreadWebview-claudeVSCodePanel] | active: Claude Code | focused: true | terminals: 
- human: "Probe d: did a confirmation dialog appear? (If yes, note its exact wording + whether it offered "always allow"; tell Claude in chat.)" -> **Yes, a confirmation**
- human: "Probe d: where did "tracer test" land?" -> **New conv in THIS window**

#### e. type command into Claude panel (2026-10-12T21:32:32.689Z)

- `claude-vscode.focus`: ok "<undefined>"
- `type {text}`: ok "<undefined>"
- tabs before:  | active: null | focused: true
- tabs after:  | active: null | focused: true | terminals: 
- human: "Probe e: did "tracer type test" appear in the Claude input (or anywhere else)?" -> **Nowhere**

#### f. prefill + submit attempts (2026-10-12T21:33:41.972Z)

- `contributed keybindings`: ok [{"command":"claude-vscode.insertAtMention","key":"alt+k","mac":"alt+k","when":"editorTextFocus"},{"command":"claude-vscode.focus","key":"cmd+escape","mac":"cmd+escape","win":"ctrl+escape","linux":"ctrl+escape","when":"!config.claudeCode.useTerminal && editorTextFocus"},{"command":"claude-vscode.blu
- `primaryEditor.open(undefined, PING)`: ok "<undefined>"
- `claude-vscode.focus`: ok "<undefined>"
- `type {text: "\n"}`: ok "<undefined>"
- `claude-vscode.focus`: ok "<undefined>"
- `editor.action.clipboardPasteAction`: ok "<undefined>"
- tabs before:  | active: null | focused: true
- tabs after: Claude Code[mainThreadWebview-claudeVSCodePanel] | active: Claude Code | focused: true | terminals: 
- human: "Probe f1: is "tracer ping: reply with the single word ok" prefilled in a Claude input in this window (not sent yet)?" -> **Prefilled, not sent**
- human: "Probe f2 (type newline): was the ping SUBMITTED (Claude starts replying)?" -> **Not submitted**
- human: "Probe f3 (clipboard + paste command): did "(paste)" text appear in the Claude input?" -> **No**

#### g. simulate commit line (2026-10-12T21:34:05.536Z)

- `append to /workspace/.dotask-tracer-status`: ok "<undefined>"
- tabs before: Claude Code[mainThreadWebview-claudeVSCodePanel] | active: Claude Code | focused: true
- tabs after: Claude Code[mainThreadWebview-claudeVSCodePanel] | active: Claude Code | focused: true | terminals: 

#### h. primaryEditor.open / editor.open with prompt, no URI (2026-10-12T21:34:47.193Z)

- `claude-vscode.primaryEditor.open(undefined, "tracer h1 ...")`: ok "<undefined>"
- `claude-vscode.editor.open(undefined, "tracer h2 ...")`: ok "<undefined>"
- tabs before:  | active: null | focused: true
- tabs after: Claude Code[mainThreadWebview-claudeVSCodePanel], Claude Code[mainThreadWebview-claudeVSCodePanel] | active: Claude Code | focused: true | terminals: 
- human: "Probe h1 (primaryEditor.open, no URI): new conversation in THIS window with "tracer h1" prefilled? Any confirmation dialog?" -> **New conv + prefilled, no dialog**
- human: "Probe h2 (editor.open, no URI): new conversation with "tracer h2" prefilled?" -> **New conv + prefilled**

#### i. terminal.open with prompt (claude CLI positional prompt) (2026-10-12T21:45:24.434Z)

- `claude-vscode.terminal.open(PING, [], "bottom")`: ok "<undefined>"
- `terminal events`: ok [{"ev":"open","name":"Claude Code","at":1791841456345},{"ev":"exec","name":"Claude Code","cmd":"claude 'tracer ping: reply with the single word ok'","at":1791841456795}]
- tabs before:  | active: null | focused: true
- tabs after:  | active: null | focused: true | terminals: Claude Code
- human: "Probe i: a terminal running claude opened. Did it ANSWER the ping ("ok") with zero keypresses? Any trust/permission prompt?" -> **Prompt blocked it (tell Claude the wording)**

#### i. terminal.open with prompt (claude CLI positional prompt) (2026-10-12T21:46:23.416Z)

- `claude-vscode.terminal.open(PING, [], "bottom")`: ok "<undefined>"
- `terminal events`: ok [{"ev":"open","name":"Claude Code","at":1791841560581},{"ev":"exec","name":"Claude Code","cmd":"claude 'tracer ping: reply with the single word ok'","at":1791841560728}]
- tabs before:  | active: null | focused: true
- tabs after:  | active: null | focused: true | terminals: Claude Code, Claude Code
- human: "Probe i: a terminal running claude opened. Did it ANSWER the ping ("ok") with zero keypresses? Any trust/permission prompt?" -> **Answered, no prompt**

#### i. terminal.open with prompt (claude CLI positional prompt) (2026-10-12T21:48:00.825Z)

- `claude-vscode.terminal.open(PING, [], "bottom")`: ok "<undefined>"
- `terminal events`: ok [{"ev":"open","name":"Claude Code","at":1791841625925},{"ev":"exec","name":"Claude Code","cmd":"claude 'tracer ping: reply with the single word ok'","at":1791841626029}]
- tabs before:  | active: null | focused: true
- tabs after:  | active: null | focused: true | terminals: Claude Code, Claude Code, Claude Code
- human: "Probe i: a terminal running claude opened. Did it ANSWER the ping ("ok") with zero keypresses? Any trust/permission prompt?" -> **Prompt blocked it (tell Claude the wording)**

#### i. terminal.open with prompt (claude CLI positional prompt) (2026-10-12T21:49:59.927Z)

- `claude-vscode.terminal.open(PING, [], "bottom")`: ok "<undefined>"
- `terminal events`: ok [{"ev":"open","name":"Claude Code","at":1791841694078},{"ev":"exec","name":"Claude Code","cmd":"claude 'tracer ping: reply with the single word ok'","at":1791841694193}]
- tabs before:  | active: null | focused: true
- tabs after:  | active: null | focused: true | terminals: Claude Code, Claude Code, Claude Code, Claude Code
- human: "Probe i: a terminal running claude opened. Did it ANSWER the ping ("ok") with zero keypresses? Any trust/permission prompt?" -> **Answered, no prompt**

#### j. sendText /clear + prompt into existing Claude terminal (2026-10-12T21:50:59.600Z)

- `target terminal`: ok "Claude Code"
- `sendText("/clear") + CR`: ok "<undefined>"
- `sendText("tracer j ...") + CR`: ok "<undefined>"
- tabs before:  | active: null | focused: true
- tabs after:  | active: null | focused: false | terminals: Claude Code, Claude Code, Claude Code, Claude Code
- human: "Probe j: was the terminal conversation CLEARED and then "tracer j" answered, with no keypress from you?" -> **Cleared + answered**

<!-- INFERENCE BELOW (hand-written) -->
