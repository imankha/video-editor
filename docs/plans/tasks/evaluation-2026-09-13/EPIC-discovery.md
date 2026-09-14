# Capability Discovery (deferred from the 2026-09-13 evaluation)

**Status:** DEFERRED - starts after the September 12-13 batch lands
**Created:** 2026-09-13
**Parent intake:** [EPIC.md](EPIC.md)

## Why this epic exists

The 2026-09-13 intake carried three P3 "gated discovery" items. One was dropped outright (T10000 -
download already shipped in the Collection Download epic, T4945/T4946/T4947). The other two are
genuine, open-ended capability questions that would each consume real time and answer nothing a
parent can use today.

**User decision 2026-09-13: put them in their own epic and run them after the current batch.** They
do not compete with the P1 repairs or the T9860 copy sweep for attention, and neither is worth
starting before T9970 provides a measured quality baseline to compare a prototype against.

## Hard rule for both

A discovery ends with **measured findings, a go/no-go recommendation and the unresolved risks** -
never with a feature marked implemented. A favourable investigation must produce separately scoped
implementation tasks before any build or rollout is claimed. Neither of these authorises a
production build.

## Tasks

| ID | Task | Gate | Status |
|----|------|------|--------|
| T9980 | [Investigate automatic athlete tracking before committing to build](T9980.md) | T9970 | DEFERRED |
| T9990 | [Investigate a combined framing and Spotlight export](T9990.md) | T9770, T9780, T9970 | DEFERRED |

## T9980 - automatic athlete tracking

The most consequential of the two, because it is the capability users already believe exists. The
2026-09-13 decision to rename **AI Focus -> Framing** was taken precisely because framing is manual
today and the name promised otherwise. If tracking ships, that decision gets revisited on purpose,
not by drift.

What it must measure, against guided manual framing and against wide/static framing as controls:
target switches, occlusion recovery, how much correction the parent still has to do, crop jitter,
latency and compute cost. Player detection already exists (YOLO on a T4 GPU, driving Spotlight);
**detection is not tracking**, and the gap between them is the whole question.

Prototype only within authorised local fixtures. Specify the fallback to manual or wide framing.

## T9990 - combined framing and Spotlight export

Today a parent who wants both pays for two renders in sequence. The question is whether one
revision-bound render can produce both without delaying the first playable result, which is the
metric that matters more.

Must measure: time to first playable versus time to the desired effected result, compute cost, and
output parity with the current two-pass path. Keep the skip-effects path intact - reducing render
count must not make every first result slower. Produces a go/no-go, the exact cost-policy questions
it raises, and a separately estimable implementation plan.

## Entry condition

**T9970 must have produced its quality rubric and baseline first.** Both discoveries are comparisons,
and without a measured baseline there is nothing to compare a prototype against. This is also the
task that gates any outcome-level quality claim in the T9860 copy sweep, so it is on the critical
path regardless.
