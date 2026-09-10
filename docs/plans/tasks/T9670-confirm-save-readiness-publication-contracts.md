# T9670: Confirm the save, readiness, publication and draft contracts

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E1-01 (UX-18, UX-08, UX-13; bug B2)**.

## Why this exists

**No code.** Several tasks in this group write copy that asserts a policy, and the walkthrough found
copy that asserts policies nobody has verified. This task records the answers **from the actual
contracts** so no placeholder policy text ships.

The user asked for all seven decision and verification tasks to be filed (2026-09-10), rather than
folding them into the tier policy.

## Questions to answer

1. **Object model.** Game / Play / Clip / Reel / Published as adopted by the Shared Vocabulary epic -
   write the definitions down with an example of each, and name the source of truth in code.
2. **Save contract.** What exactly does saving a play persist? When does a clip come into existence,
   and what makes it the *same* clip on a repeat gesture rather than a duplicate?
3. **Draft privacy.** Is a private draft genuinely private, and what exactly can a link holder see?
   The walkthrough never exercised publication, so **this is unverified, not known-good.**
4. **Publication audience.** Who can see a published clip or reel, and what does the share link
   grant? T9590's copy has to state this before the click.
5. **Autosave.** Is autosave supported anywhere? The report assumes not; confirm rather than assume.
6. **Status transitions.** The authoritative list, given T8470's Draft/Shared collapse stands.

## Output

A short decision record (in this file, or a knowledge-doc section if it belongs with
`.claude/knowledge/export-pipeline.md` / `persistence-sync.md`), with examples and the code
location that is the source of truth for each answer.

## Related Tasks

- Feeds: T9580 (save contract), T9590 (publication audience), T9600 (statuses), T9520/T9530 (nouns)
- T8470 - the standing status decision this must not contradict

## Acceptance Criteria

- [ ] Each of the six questions has a recorded answer with its source of truth in code
- [ ] Dependent tasks reference this record rather than restating policy
- [ ] No placeholder policy copy ships in any dependent task
