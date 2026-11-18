# Playable copies of iPhone video

## In plain words

iPhones record in HEVC. Chrome and Edge on many Windows laptops, and Firefox, play only its sound. This epic makes a second, ordinary H.264 copy of such a video so it plays everywhere, but only after prototypes have measured the cost and the wait, checked every fact the design assumes, and cut the wait down.

**Status:** TODO (deferred; owner ruling 2026-11-18)
**Impact:** 8 | **Complexity:** 7 (aggregate)

Epic in the **Big-file upload and video conversion** milestone (PLAN.md section 4). Design: [T17390-design.md](../T17390-design.md) (draft, approved in part, see the ruling below). Parent task: [T17390](../T17390-play-iphone-hevc-video.md). Visual summary of the design: https://claude.ai/artifact/JrBWEgdTKcKrqwaa4tZCvQ

## Owner ruling (2026-11-18)

- Work on bug fixes now, not on fully designed features. Do the low-hanging part now, outside this epic: tell the parent about the known limitation everywhere ([T17500](../T17500-sound-only-video-explained-everywhere.md), and T17370 for attached footage) and record each game's video format ([T17510](../T17510-record-game-video-format.md)).
- The conversion feature moves here and starts with prototypes: measure cost and time, de-risk every identified risk and verify every unverified fact (F1 to F5, R1 to R14 in the design) before building.
- Design questions: Q1, Q2, Q3, Q4, Q6, Q7, Q8, Q9 approved as recommended (convert every non-H.264 upload automatically; serve the copy to every browser once ready; exports read the original; we absorb the storage cost; 4K stays 4K; old games get a button, no bulk conversion; copy state in Postgres; wording as drafted).
- **Q5 rejected:** a wait of about 12 minutes per 1080p hour (45 for 4K) with a Check again button is not acceptable. Optimize the wait before shipping. The wait-time prototype (T17540) sets the target and the approach (parallel segment encoding, GPU encoding, converting while the upload is still arriving, a live ready update), and the build tasks follow what it settles.

## Order

1. Prototypes, in any order, each answering its questions with measurements written into its task notes and into the design doc: T17520 (cost and time), T17530 (copy fidelity), T17540 (wait time), T17550 (browser and color facts).
2. Design update: fold the prototype results into T17390-design.md, including the faster path from T17540 and a stated wait target, and get owner approval of that update. No build task starts before it.
3. Build: T17560 (foundation), T17570 (make the copy), T17580 (serve the copy), T17590 (parent's screens). The Postgres migration must run in an environment before T17580 deploys there.
4. Follow-ups: T17600 (saved clip extracts), T17610 (HEVC clips uploaded directly).

## Completion criteria

- [ ] Every fact F1 to F5 is verified or refuted with evidence, and every risk R1 to R14 has a measured answer or an accepted owner ruling.
- [ ] The owner approves a wait target and the design update that meets it.
- [ ] An iPhone HEVC game plays with picture and sound in Chrome on Windows without an HEVC decoder, within the approved wait.
- [ ] H.264 games are unchanged.
