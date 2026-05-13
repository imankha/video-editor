# T442: Web Share API (Native Share Sheet)

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-04-28

## Problem

After exporting a highlight reel, sharing it to social media or messaging requires: download file -> open target app -> find upload/attach -> select file -> post. This is 4-5 steps of friction that kills sharing momentum. Building individual integrations per platform (Instagram, TikTok, YouTube, WhatsApp, iMessage) is high-maintenance and still doesn't cover all platforms.

Getting reels onto **Instagram Reels and TikTok** is the highest-value flow. When a parent shares a .mp4 file to Instagram on mobile, it opens directly in the IG Reels creator with the video pre-loaded. Same for TikTok. The Web Share API makes this a one-tap action.

## Solution

Use the Web Share API to invoke the device's native share sheet directly from the gallery AND from the export-complete toast. One tap after export opens the OS-level share UI with every app the user has installed. Zero platform-specific integrations needed.

**Replaces T1090 (Social Media Auto-Posting)** -- the Web Share API covers more platforms with zero maintenance.

**Critical UX: Post-export share toast.** When an export finishes, show a prominent toast/banner with a "Share" button. Parents shouldn't have to navigate to Gallery to share -- the share action should be immediate, right when the reel is done. This is the difference between 80% and 20% share rates.

## Architecture

```
Gallery card → "Share" button → navigator.share({ files: [videoBlob], title, text })
                                       ↓
                              Native OS share sheet
                                       ↓
                    User picks: Instagram / WhatsApp / iMessage / TikTok / etc.
```

### API Surface

```javascript
// Check support
const canShare = navigator.canShare && navigator.canShare({ files: [file] });

// Share with file
await navigator.share({
  title: 'Check out this highlight!',
  text: `${athleteName} - ${clipDescription}`,
  files: [new File([videoBlob], `${reelName}.mp4`, { type: 'video/mp4' })]
});
```

### Fallback Strategy

- **Web Share with files supported** (Chrome Android 76+, Safari 15+, Chrome desktop 89+): full native share with video file
- **Web Share without file support** (older browsers): share link to shared video page (T1780) instead of file
- **No Web Share at all** (Firefox desktop): download button + copy link button

## Key Decisions

- Share the actual video file, not just a link -- recipients see the video inline in their chat/feed
- Include athlete name + clip description as share text (pre-fills IG/TikTok caption)
- Fallback to shareable link (from Core Sharing epic T1780) when file sharing unsupported
- **Post-export toast is the primary share surface** -- "Share" button on export-complete toast AND gallery cards
- File name includes athlete name for social context: `{athlete}-highlight.mp4`

## Implementation

1. [ ] Add `useWebShare` hook — detects capability level (files/link-only/none)
2. [ ] Add "Share" button to gallery card actions (next to download)
3. [ ] Add "Share" option on export-complete toast/notification
4. [ ] Fetch exported video as blob for file sharing
5. [ ] Compose share data: title from reel name, text from athlete + description
6. [ ] Fallback: share link to `/shared/:token` page when files not supported
7. [ ] Fallback: download + copy link buttons when Web Share unavailable
8. [ ] Track share events in analytics (platform not detectable, but share attempt is)

## Acceptance Criteria

- [ ] "Share" button visible on gallery cards for exported reels
- [ ] Tapping share opens native share sheet on supported devices
- [ ] Video file is included in share (not just a link)
- [ ] Share text pre-fills with athlete name and clip info
- [ ] Graceful fallback on unsupported browsers (download + copy link)
- [ ] Works in standalone PWA mode (not just browser tab)
