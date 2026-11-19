# T17710: Sync videos automatically by their sound

**Status:** TODO (future; owner ruling 2026-11-18 sets the approach; research filed 2026-11-18)
**Impact:** 7
**Complexity:** 6
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

When a game has two videos filmed at the same time (two cameras, two phones) and both have sound, the app could sync them by itself: the same whistle, cheer or ball strike is heard in both, so matching the sound tells us how far apart they are. The parent would not have to drag or nudge anything; they would only confirm. Manual Sync (T17700) stays for videos without sound or where the match is unsure.

## How we got here

Owner request 2026-11-18, after T17700: "a future task would be to check if both had audio and if they do, to line up automatically based on sound waves. Add that to the plan as well." Today the app places videos by their recorded time stamps and falls back to putting a video after the previous one; a wrong guess is fixed by hand with Sync.

Later the same day the owner asked for research on three questions (how, how long, how risky without a prototype) and added that **the two microphones will probably be across the field from each other**. The answers are in "Research findings" below.

## Research findings (2026-11-18)

### Short answers

| Question | Answer |
|---|---|
| 1. How | In the browser, in a background worker, at the moment a video is added. Pull only the sound out of the file, reduce it to a small "sound outline" (when sudden sounds happen, in a few pitch bands), and slide the two outlines against each other to find where they agree. Many short stretches of the game each vote for an offset; we accept the match only when most votes agree. |
| 2. How long | About 6 to 9 working days for a browser-only first version, including a 1.5 to 2.5 day prototype. A server path for videos uploaded before this ships adds 2 to 3 days. |
| 3. Risk without a prototype | High for the part that matters (does it find the right offset across a field, and does it know when it has not). Low for the plumbing. Do not skip the prototype; it is cheap and most of its code is kept. |

### 1. How

**The method is well known, but our case is the hard end of it.** Editing tools (PluralEyes, DaVinci Resolve, Premiere, the open-source `audalign`) and published research on crowd-filmed concerts and sports all sync by sound. They work best when the cameras are close together. Reports of failures cluster around exactly our conditions: outdoors, wind, cameras far apart. One Shotcut user filming outdoors with three cameras got 2 of 10 matches in a light breeze. That is one anecdote, not a measurement, but it points the same way as the physics below.

**What "across the field" does to the problem** (calculated, not measured):

- Sound travels about 343 m per second. Two phones on opposite touchlines are 60 to 75 m apart; end to end is about 110 m.
- A sound made right next to camera A reaches camera B about 0.2 s later (0.3 s end to end). A sound next to B does the reverse. A sound in the middle of the field reaches both together.
- So there is no single offset that lines up every sound. Each sound gives an answer somewhere in a band about 0.4 s wide. The true answer (the one where the pictures agree) is near the middle of that band.
- **Accuracy limit:** expect about 0.1 to 0.2 s (3 to 6 frames), not frame-exact. If most of the noise comes from one sideline, the answer leans toward that side by up to 0.2 s. The 0.1 s nudge in Sync is the right tool for the last step. The "within 0.1 s?" in the old C1 is not realistic for this setup.
- **The bigger problem is loudness, not delay.** Each phone mostly hears its own sideline: parents talking, wind, the person filming. The other phone barely hears any of that. Only loud field sounds are shared: the referee's whistle, a goal cheer, a horn, a coach shouting. The match has to be built from those.

**What this rules out:** comparing the raw sound waves sample by sample (the classic approach, and methods like GCC-PHAT built for microphones a few metres apart). At 70 m the two recordings are not copies of each other in that sense.

**The method that fits:**

1. **Sound outline.** Turn each video's sound into a small table: about 50 values per second in 4 to 8 pitch bands between roughly 300 Hz and 6 kHz, each value saying "how suddenly did this band get louder just now". Cutting below 300 Hz removes most wind and handling rumble. A referee's whistle sits in a narrow band around 2 to 4.5 kHz and gets its own band, because it is the best shared sound in most field sports.
2. **Level each band against its own recent past.** A conversation next to one phone is loud for a long time; a whistle is a sudden jump. Measuring jumps against the local background stops the nearby talker from dominating.
3. **Slide and compare.** Compare the two outlines at every possible offset (a standard fast calculation; under a second for a 90-minute game once the outlines exist).
4. **Vote in stretches.** Cut the shared time into stretches of 1 to 2 minutes; each stretch votes for its best offset. Stretches ruined by a nearby conversation vote at random and are outvoted.
5. **Confidence.** Accept only when a clear share of the stretches agree within about 0.3 s and the winning offset clearly beats the runner-up. Otherwise report "could not sync by sound" and leave the video where the clocks put it. The thresholds can only be set from real footage (see risk).
6. **Use the clocks as a hint.** When both files carry a recording time, search only a few minutes either side of it. That makes a false match much less likely. Without clock times, search everything.
7. **The "no overlap" case matters as much as the match.** A second-half file does not overlap the first half at all. The matcher must say "no match" there and never invent one.

**Getting the sound out of the file in the browser.** Game files are up to 4 GB (the server allows 10 GB), so nothing may load a whole file into memory.

| Option | Verdict |
|---|---|
| Read only the sound track's bytes and decode with the browser's built-in sound decoder (WebCodecs `AudioDecoder`), in a worker. Library: Mediabunny (reads byte ranges on demand, MPL-2.0, small when tree-shaken) or `mp4box`, which we already ship. | **Recommended.** About 100 to 170 MB of sound is read out of a multi-GB file. |
| `decodeAudioData` (Web Audio) | No. It needs the whole file in memory. |
| ffmpeg compiled for the browser | No. About 30 MB to download, a 2 GB file limit in its simple mode, and our pages do not send the headers its fast mode needs. |
| Play the video and listen in real time | No. A 90-minute game would take 90 minutes. |

Browser support for the built-in sound decoder: Chrome and Edge 94+, Samsung Internet 17+, Firefox desktop 130+, Safari 26+ on Mac and iPhone. Not in Safari 16.4 to 18.x, not in Firefox for Android. caniuse puts it at about 92% of global use. Unsupported browsers simply get manual Sync. iPhone HEVC files (T17390) are not a problem here: only the sound is decoded, and that is ordinary AAC.

**When and where it runs: once per video, at upload, and the outline is kept.** This is the main design proposal.

- At upload the browser already holds the file and already reads it once to fingerprint it. Making the sound outline at the same time adds tens of seconds of background work during an upload that takes minutes, so the parent waits no longer.
- The outline is small (roughly 1 to 2 MB for a full game). Game videos are stored by content fingerprint (`games/{blake3}.mp4`), so the outline can sit next to the video under the same fingerprint and be made once for everyone who has that video.
- Syncing two videos then needs only their two outlines. The browser never has to download the first video again.
- This also answers "does this file have sound?", which the app does not know today (no `has_audio` anywhere on a game video).
- The offset travels with the add-video request, the same way Veo zip imports already send their own `offset_seconds`. That keeps the write tied to the parent's gesture (adding the video), as the persistence rules require.

**Videos uploaded before this ships** have no outline. Two ways to make one, to be chosen in design:

- The browser reads the stored video's sound from R2 by byte ranges. Unverified: our pages never fetch video bytes directly today, and the R2 cross-origin rules for the production site are not written down in the repo.
- The server does it: ffmpeg reads the sound over the network (the Fly machine already probes game videos this way; it has 4 GB of memory) and numpy builds the outline. scipy is not in the production requirements and is not needed. This is the "server (python)" route. It works for every browser but means the same calculation exists twice, in JavaScript and Python, and they must agree.

Recommendation: first version is browser-only at upload; old videos and unsupported browsers keep manual Sync. Add the server path only if the prototype or real use shows too many videos fall outside.

**Other things the design must handle:**

- **Sound and picture do not always start together inside a file.** Read each track's real start time from the file; do not assume the sound starts at zero.
- **Device clocks drift.** Two devices can disagree by up to roughly 0.3 to 0.5 s over 90 minutes in a bad case, usually much less. That is the same size as the across-the-field band, so the first version uses one offset and the prototype measures how often drift shows.
- **Short videos.** A 20-second phone video against a full game has few shared sounds. Expect "could not sync" often for these.
- **How the placement was decided is not stored today.** The status line "Synced by sound" needs a record that survives a reload, so this task likely adds a column on `game_videos` (a schema change, with a `profile_db` migration).
- **Stale copy in T17700's design:** its reserved failure message says "Do it by ear below", which the owner's ruling removed. The message here should say the parent can drag to adjust.

### 2. How long

Working days of focused effort. Calendar time is longer because of the owner's test gates.

| Step | Days | Notes |
|---|---|---|
| Prototype (C1) | 1.5 to 2.5 | Includes about 1 to 2 hours of the owner's time to supply 8 to 10 real pairs and confirm the hand-synced truth. |
| Design and owner approval (C2) | 0.5 | Where it runs, the confidence rule, what the parent sees. |
| Build, browser-only at upload (C3, C4) | 4 to 6 | Worker and sound extraction, outline storage, matcher, has-sound flag, placement source column and migration, status line in the Sync panel, tests. Tier L: schema change, new pattern, three layers. |
| **First version total** | **6 to 9** | |
| Optional: server path for old videos and unsupported browsers | 2 to 3 | Python port, a job to run it, proof that both versions agree. |

The estimate assumes T17700's Sync panel has landed, since this task fills a slot in it.

### 3. How risky without a prototype

| Part | Risk if built blind | Why |
|---|---|---|
| Does it find the right offset across a field? | **High** | Shared sounds are faint next to each phone's own sideline. No published numbers for youth sports from opposite touchlines were found; tool users report failures in these conditions. |
| Does it know when it is wrong? | **High** | The confidence thresholds cannot be chosen without real matched and unmatched pairs. A wrong placement labelled "Synced by sound" is worse than no feature, and the owner's ruling forbids moving a video on a weak match. |
| Reading sound from multi-GB files in the browser | Medium | The pieces are standard, but time and memory on a phone for a 90-minute file are unmeasured here. |
| iPhone and older browsers | Medium | Safari gained the decoder only in version 26. Share of our parents on older iPhones is unknown. |
| Storing the outline, sending the offset, the status line | Low | All follow existing patterns (content-addressed storage, client-sent offsets from Veo zip, the placement write). |

**Verdict: prototype first.** The two high risks are the whole value of the feature, and both are settled by a day or two with real footage. What limits the damage if we skipped it: the fallback is manual Sync, so a matcher that rarely fires costs effort but harms nobody. A matcher that fires wrongly is the real danger, and only test footage can rule that out.

**Making the prototype cheap:** write the outline and matching code as plain JavaScript functions from the start and run them in Node against sound that ffmpeg extracts locally. Tuning is fast that way, and the same functions ship in the browser with no rewrite. Add one small browser page that only measures how long reading the sound takes on a desktop and a phone for a full-length file. Net cost over building directly is about half a day.

**What the prototype must include to be worth anything:**

- Pairs filmed from opposite sides of a field (the owner's expected case), not only side by side.
- A pair with a conversation close to one phone, and one windy pair.
- Pairs that do not overlap at all (first half against second half, or two different games), to count false matches.
- A short phone video against a full game.
- At least one indoor pair (a gym), since the product is multi-sport.

### Sources

- Mediabunny: [reading media files](https://mediabunny.dev/guide/reading-media-files), [supported formats and codecs](https://mediabunny.dev/guide/supported-formats-and-codecs), [repository and license](https://github.com/Vanilagy/mediabunny)
- Browser support: [caniuse AudioDecoder](https://caniuse.com/mdn-api_audiodecoder), [caniuse WebCodecs](https://caniuse.com/webcodecs)
- Prior art: [audalign](https://pypi.org/project/audalign/) (fingerprint and correlation alignment in Python); Bryan, Smaragdis, Mysore, [Clustering and synchronizing multi-camera video via landmark cross-correlation](https://research.adobe.com/publication/clustering-and-synchronizing-multi-camera-video-via-landmark-cross-correlation) (ICASSP 2012); Stefanakis, Chonianakis, Mouchtaris, [fingerprinting for user-generated sports video](https://zenodo.org/records/268407) (ICASSP 2017; found but its results were not read)
- Outdoor failure anecdote: [Shotcut forum, Align to reference track](https://forum.shotcut.org/t/align-to-reference-track/33893?page=2)
- Close-microphone delay methods and their limits in noise: [Interspeech 2021, Salvati et al.](https://www.isca-archive.org/interspeech_2021/salvati21_interspeech.pdf)

Not verified in this research: accuracy figures from the two papers, sound decoding on a real iPhone, and whether the production R2 bucket allows the browser to read video bytes directly.

## Solution (to be designed, after the prototype)

1. **Prototype** per "Research findings" section 3: outline and matcher as plain JavaScript functions run in Node on real pairs, plus a browser page that times sound extraction.
2. **Design** with the owner's approval: where it runs (recommended: browser, once per video at upload, outline stored beside the video), the confidence rule from the prototype's numbers, what the parent sees, and whether old videos get a server path.
3. **Build** the approved design. A confident match places the video as its starting position and tells the parent it was synced by sound, with Sync still available to adjust; a weak match moves nothing and says we could not sync by sound.

## Relevant Files

- Placement today: `compute_video_offsets` and `update_video_placement` (`PATCH /api/games/{id}/videos/{seq}/placement`) in `src/backend/app/routers/games.py`; `game_videos` columns in `src/backend/app/database.py` (placement added by `migrations/profile_db/v051_game_video_placement.py`). No column records how a placement was decided.
- Client intake: `src/frontend/src/utils/videoMetadata.js` (reads the recording time), `utils/footageIntake.js`, `hooks/useFootageIntake.js`, `services/uploadManager.js` (multipart upload; Veo zip sends its own `offset_seconds`), `modes/annotate/footageLanding.js`.
- Existing pieces to reuse: `mp4box` (used by `utils/shrinkCapability.js`), the module worker pattern in `utils/veoHighlights/readDurations.js`, server ffprobe over range reads in `src/backend/app/services/video_probe.py`.
- Sync panel slot: `T17700-design.md` ("T17710 slot", copy keys `SYNC_AUTO_OK`, `SYNC_AUTO_FAILED`).
- Knowledge docs: `.claude/knowledge/annotate.md`, `.claude/knowledge/persistence-sync.md`, `.claude/knowledge/modal-gpu.md`.

## Acceptance Criteria

- [ ] C1: A prototype measures the offset on real pairs of game videos against a hand-synced truth, including opposite sides of a field, a conversation close to one mic, wind, a short video against a full game, an indoor pair and pairs that do not overlap. It reports accuracy (how many confident matches land within 0.25 s), how often it wrongly claims a match, how often it gives up, and the time to read the sound of a 90-minute game on a desktop and a phone.
- [ ] C2: A design with the owner's approval picks where it runs, the confidence rule, and what the parent sees.
- [ ] C3: Two overlapping videos with sound are synced within the approved accuracy with no parent action, and the parent is told.
- [ ] C4: A video without sound, or a weak match, is left to manual Sync with a clear message; nothing is moved silently.

## Ruling

**Owner, 2026-11-18:** parents are not asked to sync by ear (T17700). When both videos have sound, our technology tries to sync them, and the parent drags to adjust. Ideally the **client** (the parent's browser) analyses both waveforms and uses the best match as the second camera's **starting position**, which the parent then confirms or adjusts by dragging. The matcher must account for:

- **Microphones far apart.** Two phones at opposite ends of a field hear the same whistle at different times (sound travels about 343 m per second, so 100 m adds about 0.3 s). The match is the offset that best explains the shared events, not a sample-exact identity; report it as an estimate the parent can adjust. **Owner, later the same day:** the mic sources will probably be across the field from each other, so treat this as the normal case.
- **Foreground sound at one mic.** A conversation, wind or a parent cheering right next to one phone is loud on that track only. Prefer events both mics hear (whistles, horns, crowd swells, ball strikes): for example, match on onset or energy envelopes in frequency bands where field sounds dominate rather than raw samples, weight by agreement across several windows of the game, and require a clear winner over the next-best offset.
- **Confidence.** A weak or ambiguous match must not move the video silently: leave it where the clocks put it, tell the parent we could not sync by sound, and let them drag.

Where it runs: client first (owner preference). A server or Modal fallback is a design question only if the prototype shows the browser cannot decode or process the audio fast enough, or for videos uploaded before this ships.
