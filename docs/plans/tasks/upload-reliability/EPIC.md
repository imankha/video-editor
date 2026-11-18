# Upload reliability

## In plain words

Large game uploads fail or make the parent wait. These tasks keep an upload going through network drops and let a parent start on a play before the whole file has arrived, whether or not we ever shrink or convert video.

**Status:** TODO
**Impact:** 8 | **Complexity:** 6 (aggregate)

Epic in the **Big-file upload and video conversion** milestone (PLAN.md section 4), created 2026-11-18 when the milestone was split into epics. Tasks: [T15840](../T15840-game-upload-survives-network-drop.md) and [T8865](../pre-shrink-integration/T8865-highlights-before-upload-completes.md) (its file stays in its original folder). T8865 also matters to [Playable copies](../playable-copy/EPIC.md): converting the parts that have already arrived needs the same per-part availability.
