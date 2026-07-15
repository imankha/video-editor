# T5140: Reshoot Tutorial Videos (baked-in slow audio, 1x playback)

**Status:** TODO
**Priority:** P2
**Impact:** 6 | **Complexity:** 3

## Summary

Reshoot the in-app quest tutorial videos. Two reasons this is a polish-tail task:

1. **UI will have changed by the end of Polish.** The current recordings show older screens; they must be re-captured against the final alpha UI so they don't mislead users.
2. **Bake the slow narration into the source instead of forcing a slow default playback rate.** Today the tutorial modals default `DEFAULT_RATE` to `0.8` because 1x narration runs too fast (see [TutorialVideoModal.jsx](../../src/frontend/src/components/TutorialVideoModal.jsx) and [TutorialModal.tsx](../../src/landing/src/components/TutorialModal.tsx)). On the reshoot, slow the **audio** to the `0.8` pace at production time so the delivered videos play correctly at **1x**. Then flip both `DEFAULT_RATE` constants back to `1`.

## Requirements

- Re-record all quest tutorials against the final UI.
- Produce audio at ~0.8x pace (comfortable narration) while keeping video playback at 1x — i.e., no runtime `playbackRate` slow-down needed.
- After the new assets ship, set `DEFAULT_RATE = 1` in both tutorial modals.
- Regenerate/verify chapter + subtitle (VTT) sidecars for the new cuts.

## References

- Tutorial assets contract: producer truth lives in `ReelBallersTutroials/workflow/contract.py`; app copy in `tutorialVideos.js`. Key scheme `tutorials/{quest}.{mp4,vtt,chapters.vtt}` at `assets.reelballers.com` (public R2 domain + CORS).
- Original quest tutorial task: [T4780](T4780-quest-tutorial-videos.md).
- Landing tutorial video: [T3300](T3300-tutorial-video-landing-page.md).

## Notes

Depends on the alpha UI being frozen — do this after other Polish work lands so the recordings match what users actually see.
