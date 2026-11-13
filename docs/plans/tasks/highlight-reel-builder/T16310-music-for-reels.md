# T16310: Music for reels

## In plain words

A reel (several highlights, which are finished short clips, joined into one video) keeps the sound of each highlight, and one switch mutes it. The owner also wants a parent to be able to lay a music track under a reel, on one condition: that we find an open music bank (a library of tracks anyone may use) with a good sports or high-energy category. The catch is the licence. Most free libraries let a person use a track in their own video but do not let an app hand those tracks out to its users, and a parent's reel then goes to Instagram and YouTube, where unlicensed music gets a video muted or taken down. So this task has two halves. First find a bank whose written terms cover an app offering its tracks to users, with at least twenty tracks that suit a sports reel. Only then build a short picker. Done when the owner has approved a bank and a parent can pick a track, hear it in the preview and export a reel with it. If no bank qualifies, the task ends with that written down and nothing built.

**Status:** TODO
**Impact:** 5
**Complexity:** 6
**Created:** 2026-11-13
**Updated:** 2026-11-13
**Milestone:** Highlight reel builder (see [EPIC.md](EPIC.md)). Task 5 of 6.
**Waits on:** the bank search in step 1, and the owner's yes to one bank from it.

## How we got here

The decision page recommended keeping each highlight's sound with a mute switch and no music library, because licensed music is a cost and a legal project of its own and recruiting guides say coaches watch muted. On 2026-11-13 the owner accepted that as the base and added that music should be supported too if a good open bank exists. A reel for family at the end of a season is where music matters; a reel for a coach is where it does not.

## The problem

"Free" music comes with terms, and three of them matter here:

- **Handing tracks out.** We would store the tracks and offer them inside our app. Many licences forbid passing the tracks on except as part of a finished video.
- **Credit.** Some licences require the artist's name wherever the video is shown. A parent posting to Instagram will not add it, so we would have to put it on the reel itself or avoid those tracks.
- **Takedowns.** Even a properly licensed track can be claimed by an automatic copyright check on YouTube or Instagram if its artist registered it there. Each chosen track needs checking.

## What the first look found (2026-11-13)

A quick search, not yet the full check. Nothing below is confirmed as usable.

| Bank | Cost | What its terms appear to say | Fit |
|---|---|---|---|
| FreePD and similar collections of tracks given to the public with no rights kept | Free | No conditions at all: no credit, any use, including inside an app | Safest terms. Quality and the number of sports tracks are unknown and need a listen |
| Free Music Archive, filtered to tracks with no rights kept | Free | Same as above for the filtered tracks only; each track states its own terms | Larger; needs track-by-track checking |
| Incompetech (one composer, Kevin MacLeod) | Free with credit, or a paid licence without | Free tracks require a credit line | Well-known action tracks; credit must appear on the reel or we pay |
| Pixabay Music | Free | No credit needed, but forbids handing tracks out on their own; says nothing about an app offering them to its users | Big sports category; needs a written answer from Pixabay before we rely on it |
| YouTube's own audio library | Free | Reported as limited to videos on YouTube | Not usable |
| Jamendo, Soundstripe and other paid services built for apps | Priced on request | The app holds the licence and its users are covered | Cleanest legally; has a running cost, which the owner did not ask for |

## What we will do

1. Check the candidates properly: read each bank's full terms, write to Pixabay, listen to the sports and high-energy tracks, and test five tracks from each surviving bank on YouTube and Instagram for copyright claims. Write the result into this file.
2. Bring the owner one recommended bank, or the finding that none qualifies.
3. If a bank is approved: copy twenty to thirty chosen tracks into our own storage, each with its name, artist, length and terms.
4. Add "Music" to the reel's sound setting: none (the default), or one track from a short list grouped by feel, each with a play button.
5. The track plays under the whole reel, fades out at the end, and repeats if the reel is longer than the track. The parent chooses whether the highlights' own sound stays underneath, quieter, or is turned off.
6. The preview plays the music, and the exported reel has it.

## Why this and not something else

Letting a parent upload their own song is the most-requested version of this in other apps and the fastest route to takedowns, because the song is almost never theirs to use. A paid service built for apps is the cleanest legally but adds a monthly cost for a feature 18 parents could use today. Cutting highlights on the beat of the music is what the big phone editors do and is a project many times this size. A short hand-picked list is the smallest thing that makes a family reel feel finished.

## How we will know it worked

- [ ] The search result is written in this file: for each bank, its terms on handing tracks out, on credit, and the takedown test.
- [ ] The owner has approved one bank from that result, or has closed the task because none qualifies.
- [ ] A parent on a phone can choose a track from at least twenty, hear it before choosing, and remove it again.
- [ ] The preview plays the track under the reel, and the exported reel has it, fading out at the end.
- [ ] A reel longer than its track has no silent gap.
- [ ] A reel with no music exports exactly as before, and as fast.
- [ ] If the chosen terms require a credit, it appears on the reel without the parent doing anything.
- [ ] Five exported reels with different tracks, posted to YouTube and Instagram, receive no copyright claim.

## For the implementer

### Related Tasks
- Depends on: T11300 (the reel and its sound setting), T16280 (the render job, which leaves room for one extra sound input).
- Related: T16290 (preview playback).

### Relevant Files (REQUIRED)
- `src/backend/app/services/ffmpeg_concat.py`, `src/backend/app/modal_functions/video_processing.py` - mix one track under the reel
- `src/backend/app/routers/reels.py` (new in T11300) - surgical write for the chosen track and the keep-sound switch
- `src/frontend/src/components/reels/` (new in T11300) - music picker
- `src/frontend/src/constants/displayNames.js` - copy

### Technical Notes
- A reel with music can never take the copy-only fast path for sound, but the picture can still be copied when the transition is a cut: re-encode audio only.
- Tracks live in our own storage, never hot-linked from the bank; keep the terms text and the date fetched beside each track.
- Loudness: normalise tracks once at ingest; duck the track under highlight sound by a fixed amount, named in one place.
- Sources read on 2026-11-13: pixabay.com/service/license-summary, incompetech.com/music/royalty-free/licenses, soundstripe.com/blogs/music-licensing-for-apps.
