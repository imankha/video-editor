# T5580: Enable react/jsx-uses-vars so JSX-only imports stop false-flagging as unused

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-07-19

## Problem

The frontend eslint config (`src/frontend/eslint.config.js`) registers `eslint-plugin-react` and turns
OFF `react/jsx-uses-react` + `react/react-in-jsx-scope` (correct for the React 17+ JSX transform) but
**does not enable `react/jsx-uses-vars`**. That rule is what marks a variable referenced only in JSX
(`<Foo />`) as "used". Without it, every component/icon import that's used ONLY in JSX gets
false-flagged by `no-unused-vars`.

This is most of the frozen 998-warning backlog (T4790) and it actively bites: T5570 (overlay circle
fixes) tripped the "ESLint regression gate (whole src must not regrow the backlog)" purely because it
added a `Move` icon import + a dev-harness that are used in JSX but read as unused. It had to be
worked around with `// eslint-disable-next-line no-unused-vars` comments (see the T5570 lint-fix
commit) — a smell that will recur on every new JSX import.

## Solution
- Add `"react/jsx-uses-vars": "error"` (part of `plugin:react/recommended`) to the rules in
  `eslint.config.js`.
- Re-run `npx eslint src` to get the new (much lower) warning count; the false-positive
  `no-unused-vars` on JSX-only imports should vanish repo-wide.
- **Ratchet the Branch CI baseline DOWN**: `.github/workflows/branch-ci.yml` line ~48
  `npx eslint src --max-warnings 998` → set to the new actual count (the workflow comment says ratchet
  DOWN as the backlog clears; never up).
- Remove the now-unnecessary `eslint-disable-next-line no-unused-vars` workarounds added in T5570
  (HighlightOverlay `Move` import; `src/overlaydiag/main.jsx` HighlightOverlay import + OverlayDiagHarness).

## Acceptance Criteria
- [ ] `react/jsx-uses-vars` enabled; `npx eslint src` warning count drops (JSX-only-import false
      positives gone); 0 errors.
- [ ] Branch CI `--max-warnings` baseline ratcheted down to the new count.
- [ ] T5570's eslint-disable workarounds removed and the files still pass the gate.
- [ ] No genuinely-unused import is masked (a component imported but never rendered still warns).

## Classification hint
S/M-tier, frontend lint-config only. No product code, no schema. Verify by running the gate locally
and confirming the count drops + the T5570 disables can be removed.
