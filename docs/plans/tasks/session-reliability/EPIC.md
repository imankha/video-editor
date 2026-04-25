# Session Reliability

**Status:** TODO
**Started:** 2026-04-24

## Goal

Ensure user sessions survive machine restarts and deploys, and that requests consistently route to the machine holding the user's data. Today, sessions created during OAuth are never synced to R2, so a deploy silently logs users out. Machine pinning then solves the broader affinity problem.

## Tasks

| # | ID | Task | Status |
|---|-----|------|--------|
| 1 | T1195 | [Session Durability on Deploy](T1195-session-durability-on-deploy.md) | TODO |
| 2 | T1190 | [Session & Machine Pinning](../for-launch/T1190-session-machine-pinning.md) | TODO |

## Sequencing

T1195 first: it's a narrow fix (sync auth.sqlite to R2 after session creation) that prevents session loss on deploy right now. T1190 is the broader solution (machine pinning via fly-replay) that eliminates the class of problems caused by requests landing on different machines.

## Completion Criteria

- [ ] Sessions survive machine restarts (T1195)
- [ ] Requests route to the correct machine (T1190)
- [ ] No silent logouts after deploy
