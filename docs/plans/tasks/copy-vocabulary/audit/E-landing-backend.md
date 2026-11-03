# Sweep E: Landing site + backend user-visible copy

Scope: `src/landing/src/**` (all pages, components, data, content/guides, site.ts, llms.txt, layouts) and backend/edge user-visible text (`app/services/email.py`, `routers/email_subscription.py`, Cloudflare share/unfurl functions at `src/frontend/functions/shared/**`, `HTTPException detail=`, export progress `message`s, server-generated names/filenames).
Counts are grep counts over prose files (`*.astro`, `*.mdx`, `data/*.ts`, `site.ts`, `llms.txt.ts`), case-insensitive, so they include FAQ/JSON-LD copies of the same sentence. They are approximate. In-app words used for comparison: Add Game, Mark play, Frame (header) / Framing, Spotlight, Games / Clips / Finished tabs, Credit history labels ("Video generation", "Game upload", "Clip upload"), `Failed to save play` / `Failed to update highlight`.

Line numbers: landing files are real file lines. `index.astro`, `how-it-works.astro`, `[sport].astro` etc. verified by grep. Backend file:line verified by grep/sed.

---------------------------------------------------------------------
## 1. TERM INVENTORY

### 1.1 The recorded game (source video)

LANDING (about 160 "footage", 42 "film", 39 "game video / match video / game file / full game / full match / recording", about 160 "video"):
| Word / phrase | Verbatim example | Where |
|---|---|---|
| game footage | "Turn Game Footage Into Highlight Reels" | index.astro title (title attr ~line 120), site.ts:50 |
| game film | "Transform game film into high-quality highlights" (TAGLINE) | site.ts:27, index meta description |
| footage (generic, most common) | "Upload the footage you already filmed" | how-it-works.astro:18, cameras.ts, sports.ts |
| match footage / match video | "Download the full match video from your account" | [camera].astro, cameras.ts:46,64 |
| game video | "Watch 10+ hours of game footage" / "two-hour game file" | index.astro:207 "a two-hour game file" |
| "your video(s)" | "Upload your video(s)" | index.astro:99, how-it-works.astro:17 |
| game file / video file | "Any standard video file" | many |
| full game / full match / full-length | "Built around full-match uploads" | comparisons.ts:189 |
| the game / the match | "Watch the game and mark each moment" | how-it-works.astro:22 |
| sideline video | "your wide sideline video becomes close-up footage" | index.astro:287 |
| "recording" | "two-hour recording" | mdx guide |

BACKEND/EDGE:
| Word | Example | Where |
|---|---|---|
| game | "Your game is ready" / "View Game" / "shared a game with you" | email.py:952,1147,1160 |
| game footage | "shared game footage with you" (subject) | email.py:1146 |
| game film | "uploading game film to downloading a finished highlight" | email.py:442 (welcome) |
| Video | "Shared Video" (og default), "Video file not found in storage" | functions/shared/[token].js:202; downloads.py:1095 |
| Game / Untitled Game / `Game {id}` | default names | clips.py:3505, collections.py:474, downloads.py:430 |
| video 1/2 ("sequence") | "No video with sequence {n} for this game" | games.py:1060, suggestions.py:140 |

### 1.2 The marked moment (play / clip / highlight / draft / moment)

LANDING (play(s) about 325 incl. "play type"; clip(s) about 82; moment(s) 23; draft 2; "highlight" used for BOTH the marked moment and the finished output):
| Word | Verbatim | Where |
|---|---|---|
| "plays" (the marked thing) | "Mark the plays that matter" | index.astro:104; how-it-works.astro:21 "Mark the plays worth keeping" |
| "moments" | "Leave notes on the moments that matter" | index.astro:269; how-it-works.astro:22 "mark each moment worth keeping" |
| "clips" (marked thing) | "tag teammates so everyone gets their clips"; "Build a library of clips" | index.astro:271ish, :338 |
| "marked play -> highlight" | "Turn any marked play into a highlight" | index.astro:339 |
| "tagged plays" / library | "Can I reuse my tagged plays?" | how-it-works.astro:52 |
| "a clip" (what you frame) | "Choose the player each clip is about" | how-it-works.astro:26 |
| "draft" | "A draft you haven't generated stays viewable" | index.astro:455 (only 1 place; also 1 in comment) |
| "play" as the PRICING UNIT | "~{n} plays" per pack; "A typical play uses ~N" | index.astro:395, 421 |
| "highlight" = each marked moment turned finished | "generate a highlight for each" | sports.ts:69,90,... |
| "highlight clips" | "their own highlight clips" | useCases.ts for-coaches description |
| "play type" (preset tags) | "136 play types" | index.astro, sports.astro |

BACKEND:
| Word | Example | Where |
|---|---|---|
| "play" | "Delete the play to reopen an accepted suggestion" | suggestions.py:238 |
| "moment" | "Each moment must span at least half a second"; "Moment runs to 123s but video 2 is 60s: wrong video?" | suggestions.py:130,147 |
| "clip" | "Clip not found", "Clip already in project", "Only uploaded clips can be linked to a game" | clips.py:520,2245,1931 |
| "Raw clip" | "Raw clip not found" (x9) | clips.py:1038,1080,1750,1904,1929,1968,2265 |
| "Working clip" | "Working clip not found" | clips.py:2753,3197,3327 |
| "highlight" (marked moment) | "Untitled Highlight" (default name of a clip), "No highlights selected" | clips.py:3541, downloads.py:2071,2412 |
| "highlight" (finished) | "shared a highlight with you" | email.py:1008 |
| "annotations / annotated plays" | "shared game annotations with you", "Watch Annotations", "Annotated plays from {game}" | email.py:1213-1228 |
| "draft" | "No poster for this draft" | projects.py:1377 |
| "reel" (single finished video) | "Reel not found", "No poster for this reel", "multi-clip reels are no longer editable" | rank.py:343,414,440; downloads.py:1689 |
| "Top Plays" | default all-scope collection title | collections.py:1503ish (`"Top Plays"`) |
| auto clip names | "Brilliant Goal", "Good Dribble and Assist", "Interesting ...", "Skill miss Goal", "Decision miss Dribble" | constants.py:102-108 + queries.py:17-76 (derive_clip_name) |

### 1.3 The finished video

LANDING (highlight reel(s) 71; "highlight video(s)" 27; "highlight(s)" 246 (incl. above); standalone "reel(s)" about 85; "finished (video|highlight|clip)" 6):
| Word | Verbatim | Where |
|---|---|---|
| highlight reel | "How do I make a highlight reel from game footage?" | index.astro:48; sport/camera pages everywhere (`How to make a {sport} highlight reel`) |
| highlight | "Share the finished highlight with one link" | index.astro:309 |
| highlight video | "Soccer Highlight Video Maker" | sports.ts:64 (all 11 sport titles); llms.txt "[Soccer highlight videos]" |
| highlight reel maker | "Flag football highlight reel maker" (the one sport that differs from "Highlight Video Maker") | sports.ts:127-130 |
| reel (alone) | "make a reel", "recruiting reel", "football reels" | useCases.ts, sports.ts:113,140, mdx |
| "video" / "finished video" | "1 credit per second of finished video" | index.astro:446; site.ts:101 |
| "finished clip" | "so the finished clip looks like it was filmed close-up" | index.astro:60 (FAQ 3) |
| "highlight clips" | for-coaches meta | useCases.ts:181 |
| "shareable cut" / "version" | "producing a shareable cut"; "wide recruiting version" | cameras.ts:120, many |
| "recruiting-ready highlights" | | sports.ts |
| "one highlight in multiple formats / aspect ratios" | index.astro:340; index.astro:81; about.astro:114 |

BACKEND/EDGE:
| Word | Example | Where |
|---|---|---|
| highlight | "{name} shared a highlight with you"; CTA "Watch Highlight" | email.py:1008,1022 |
| video | "shared a video with you" (footer reason, same email as above) | email.py:1023 |
| "Final video" | "Final video not found" | before_after.py:269; overlay.py:1833 |
| "Download" | "Download not found" (x9) | downloads.py:975,1351,1408... |
| Edge share page | "Shared Video", "Make your own highlights at www.reelballers.com", "Download", "Open ReelBallers" | functions/shared/[token].js:202,302,306-307 |
| unfurl desc | "{name} -- shared from ReelBallers. Make your own free." | functions/shared/[token].js:209 |
| filename | `{Name}_ReelBallers.mp4` | downloads.py:694 |
| fallback name | `video` | downloads.py:687 |

### 1.4 Collection of finished videos

LANDING: "collection" only 4 uses and NOT as the combined-video concept: "tagged by play type, with a collection for each tag" (comparisons.ts:165). The concept (combining finished highlights) is never described on the landing site. "reel" is used (wrongly vs brand rule) for a single video everywhere instead.
BACKEND: "collection" (email.py:877 "shared a highlight collection with you"; subject 2nd touch "New shared collection: {title}"; CTA "Watch Highlights"; footer "shared a collection with you"), "Collection has no members to download", "Collection stitch failed" (collections.py:1039,1188), "Mixes" (bucket/scope name; collections.py:840,1503; `Mixes.mp4`), "Top Plays", "{Game} Game Highlights - Portrait/Landscape (2:30)" (collections.py:1495-1510), filename `Game_Highlights.mp4` / `Highlights.mp4`. Internal docstring says "current reels" (email.py:862) and counters named `reel_count`.

### 1.5 Editing steps / mode names

LANDING uses FOUR different step vocabularies:
| Where | Names |
|---|---|
| index.astro:99-111 (hero "How it works") | "Upload your video(s)" / "Mark the plays that matter" / "Generate and share one link" (3 steps; line 207 "Three steps") |
| how-it-works.astro:17-30 | "Upload your video(s)" / "Mark the plays worth keeping" / "Frame and spotlight your player" / "Generate and share" (4 steps; line 87 "Four steps") |
| how-it-works.astro:137-150 ("See each step") | "Annotate" / "Frame & highlight" / "Share" |
| index.astro:266,284,306 (showcase) | "Educate" / "Elevate" / "Celebrate" (illustrations still named Learn/Elevate/Celebrate; site.ts:91 "the Elevate step") |
| tutorials.ts:29-32 | "Mark plays" / "Framing" / "Spotlight" / "Share" |
| llms.txt.ts:25-33 | "Upload" / "Mark" / "Generate" (and "the three-step process" at :74) |
| App | Add Game, Mark play, Frame/Framing, Spotlight, (Finished tab) |

BACKEND: email.py:571-575 internal report uses "Annotate", "Framing", "Overlay"; user-visible: "Export from Focus mode first" (detection.py:344,391; retired name), "Validating project...", "Starting generation...", "Starting overlay generation...", "Processing video...", "Copying video...", "Concatenating clips...", "Uploading to cloud storage...", "Export complete!", "Export complete (no overlay effect)".

### 1.6 Crop / frame

LANDING: "frame your player" (about 40), "framing" (49 total "framing"), "crop box" ("a few drags of the crop box"), "drag the crop over them", "crop" (75; verb "cropping into 4K"), "reframe", "keyframed crops" / "keyframe" (5; comparisons.ts:67,91,170), "in focus" ("afterLabel=In focus", index.astro:173), "put the focus on your athlete" (index.astro:110), "focus" ("AI focus", site.ts:36).
BACKEND: "crop keyframes" / "No crop keyframes provided" (framing.py:69), "Invalid crop_data in database" (framing.py:306), "Invalid keyframes JSON" (exports.py:634), "Focus mode" (detection.py:344).

### 1.7 Spotlight

LANDING: "spotlight" (39): "spotlight marker", "animated spotlights", "spotlight effect", "spotlight graphics", "spotlight your player" (verb), "highlight on your athlete" (useCases.ts:54 "a spotlight or highlight on your athlete"), "marker" ("player marked or spotlighted"), "Frame & highlight" (how-it-works.astro:144, where "highlight" = the spotlight).
BACKEND: "overlay" ("Overlay generation failed", "Starting overlay generation...", overlay.py:1622,1368), "highlight regions", "highlight keyframes" (overlay.py:1407,1434), "poster marker" (overlay.py:2251), "auto/marker cover image" (overlay.py:2309), "highlight image" (overlay.py:2181).

### 1.8 Credits / pricing

LANDING: "credits" (43), "free credits" (88), "credit per second of finished video", "Storage 1 credit per GB per 30 days", "plays" as unit ("~N plays" per pack), "Most Popular" / "Best Value" badges, "Pay only for the AI you use", "No subscription", "Free to start", "Credits never expire", "How credits work" (button, scrolls to FAQ), "How long we keep things" (index.astro:452), "extend it anytime".
BACKEND: credit history labels live in frontend; backend `insufficient_credits` JSON (framing.py:338) and email "earn free credits" for reports (email.py:444). "Payments not configured", "Invalid pack: x" (payments.py:277,281).

### 1.9 AI upscaling

LANDING: "AI upscaling" (hero/tagline), "upscales toward 4K" (about 12), "AI focus smooths, spotlights and upscales" (site.ts:36), "upscaler" (cameras.ts:109), "AI-proposed player boxes" (index.astro:292, about.astro:100, comparisons.ts:218, llms.txt:62), "the AI you use", "motion interpolation between your marks", "smooths the motion", "connects the motion in between", "sharp", "high-quality", "pro-quality".
BACKEND: "AI upscaling dependencies not installed", "AI SR model failed to load", "CUDA not available - GPU required for AI upscaling", "GPU out of memory - try closing other GPU applications" (multi_clip.py:1096,1110,1684,1712,1719,1726).

### 1.10 Sharing

LANDING: "share it with one link", "shared highlight", "no app, no account, no sign-up wall", "Share" (step), "Sharing by link, at full resolution", "post to Instagram or TikTok in a tap".
BACKEND: "shared a highlight / a game / game annotations / a highlight collection", "Watch Highlight(s)", "View Game", "Watch Annotations", "Add this game to your account", "team recap", "Filmed by X's family", "Storage expired - extend storage to share this game." (games.py:3131,3581).

### 1.11 Athlete / player / kid

LANDING: player (about 155; dominant), athlete (26), "kid" (about 9: "your kid", "your kid's games"), "child" (8, "your child is small in the frame"), "son"/"daughter" (testimonials only), "skater", "my son". 
BACKEND: "{tag_name}" (teammate tag), "player" in intro-card consent ("using this player's likeness"), email "my son's games" (welcome).

### 1.12 Team

LANDING: "team" in "tag teammates"/"teammate" (5), "your team", "team camera systems", "club", "roster". BACKEND: "teammate" ("Teammate email mapping not found" clips.py:3427; email "tagged {tag} in a highlight"; edge "Team recap").

### 1.13 Punctuation / tone counts
- " -- " double-hyphen used as dash in visible copy: about 127 occurrences in landing prose (includes FAQ answers, hero-adjacent copy, schema text). Literal em dash: 0 in landing (but see backend: clips.py:750 and games.py `—`, test_seams). Backend OTP/welcome copy honours "no em dashes".
- Casing: landing CTAs sentence case ("Start free", "Get started free"), email CTAs Title Case ("Watch Highlights", "Start Making Highlights", "View Game"), edge CTAs mixed ("Add this game to your account", "Open ReelBallers", "Download").
- "Click" vs "Tap": landing prose never says "click" in copy except one: "[sport].astro:39 'tagging is a click rather than typing'". "tap" used 4x (index "tap", "Tap to play comparison", "Tap to unmute").

---------------------------------------------------------------------
## 2. FINDINGS

Legend: INCONSISTENT / JARGON / UNCLEAR / CONTRADICTION / OVERCLAIM / TONE/STYLE / RAW-ERROR / APP-MISMATCH.
Priority: P1 = fix first.

### A. Concept words (the main goal)

**A1 (P1) APP-MISMATCH / INCONSISTENT. Landing never uses the app's step words and never tells visitors where "Mark play", "Games/Clips/Finished" are.**
- Landing: "Mark the plays that matter" (index.astro:104) is the only close match. The app's actual words are Add Game, Mark play, Frame, Spotlight, Finished. Landing instead says "Educate / Elevate / Celebrate" (index.astro:266,284,306), "Annotate / Frame & highlight / Share" (how-it-works.astro:137,144,150), "Learn" illustration names, and tutorial labels "Mark plays / Framing / Spotlight / Share" (tutorials.ts:29-32, currently unmounted).
- Why it confuses: a parent reads "Elevate" on the site and finds buttons named Frame/Spotlight in the app. "Annotate" is film-room jargon.
- Rewrite: use ONE sequence everywhere: "Add your game", "Mark plays", "Frame", "Spotlight", "Share". Retire Educate/Elevate/Celebrate headings (keep only as internal illustration names; fix `site.ts:91` comment "Elevate step"). `how-it-works.astro:137` "Annotate" -> "Mark plays"; `:144` "Frame & highlight" -> "Frame and spotlight".

**A2 (P1) INCONSISTENT. The marked moment is called "play", "moment", "clip", "highlight", "draft" and "annotation".**
- Landing: "Mark the plays that matter" (index.astro:104) -> "Build a library of clips" (:338) -> "Turn any marked play into a highlight" (:339) -> "A draft you haven't generated" (:455) -> "Leave notes on the moments that matter" (:269). `how-it-works.astro:26` "Choose the player each clip is about". `how-it-works.astro:52` "tagged plays". useCases.ts:132 "Because each clip is tagged, the library compounds".
- Backend: "Untitled Highlight" for an unnamed clip (clips.py:3541), "No highlights selected" for picking finished videos (downloads.py:2071), "Raw clip" / "Working clip" (clips.py), "annotated plays / annotations" (email.py:1213-1228), "No poster for this draft" (projects.py:1377), "moment" (suggestions.py:130,147), "play" (suggestions.py:238).
- Why: a parent cannot tell whether a "clip" and a "play" and a "highlight" are the same object, or which one they will pay for.
- Rewrite (parent-natural): marked moment = **play** everywhere (matches the "Mark play" button); finished output = **highlight**; drop "draft"/"clip"/"moment"/"annotation" in user copy. E.g. index.astro:338 "Build a library of clips" -> "Keep every play you mark"; :455 "A draft you haven't generated" -> "A play you haven't turned into a highlight yet"; email.py:1213 "shared game annotations" -> "shared marked plays"; clips.py:3541 "Untitled Highlight" -> "Untitled play" (when it is a marked play); projects.py:1377 "No poster for this draft" -> "No cover image yet".

**A3 (P1) INCONSISTENT / brand-rule. "Reel" is used for single finished videos on landing, in share pages and backend, but brand rule is "reel" only for a collection.**
- Landing: "highlight reel" 71x as the finished single output: "How do I make a highlight reel from game footage?" (index.astro:48), "Why highlight reels never get made" (:320), "Weeks to make one highlight reel" (:330), "How long does making a highlight reel take?" (how-it-works.astro:36), `How to make a ${sport.lower} highlight reel` ([sport].astro:86,130), "Flag football highlight reel maker" (sports.ts:130), "Your player's next highlight reel is minutes away" (Cta.astro:17 default heading, used on many pages), "Make your {sport} highlight reel" ([sport].astro:223), "How to edit Veo footage into a highlight reel" (cameras.ts h1s), DEFINITION "shareable highlight reels" (site.ts:50, used in schema + home + about), testimonial quotes "create a reel" / "highlight reel" (testimonials.ts). Note: mixed with "Highlight Video Maker" for the other 10 sports (sports.ts:64 etc) and "highlight videos" in llms.txt.
- Backend: "Reel not found" (rank.py:343,414,440), "No poster for this reel" (downloads.py:1689), "multi-clip reels are no longer editable" (log), collection email docstring "current reels"; `reel_count`, `utm_campaign=reel_endcard`.
- Why: "reel" means a compilation to most people; the landing promise (one 15s highlight per play) and the in-app Finished tab (single videos) differ. SEO value of "highlight reel" is understood, but the app then never uses it.
- Rewrite: finished single = "highlight"; collection = "highlight reel". Keep "highlight reel" ONLY where the page genuinely describes a compilation (e.g. recruiting video pages, which are compilations) and add that sense explicitly: "Combine your highlights into a highlight reel". Change Cta.astro:17 to "Your player's next highlight is minutes away"; index.astro:48 FAQ "How do I make a highlight from game footage?"; [sport].astro:86/130/223 to "highlight" or "highlight video"; flag football title to "Highlight Video Maker" for consistency.

**A4 (P1) INCONSISTENT. Source video called game film / game footage / match video / game file / "your video(s)".**
- site.ts:27 (TAGLINE) "game film"; index title "Game Footage"; index.astro:207 "a two-hour game file"; index.astro:99 "Upload your video(s)"; sports pages mix "game film" ("football game film", sports.ts:111,90,153,174) and "match footage" (soccer, volleyball, lacrosse, rugby, tennis); cameras.ts "match video"; useCases.ts:189 "game film is organised by match"; email.py:442 "game film"; email.py:1146 "game footage"; game-ready email "Your game is ready"; app word is "Game" ("Add Game").
- Why: parents search "game video", the app says "Game"; "film" and "footage" read as industry words; "file" reads technical.
- Rewrite: **game video** (or "your game") in headings/steps; allow "footage" only in camera pages. site.ts:27 -> "Turn your game video into sharp highlights in minutes with AI upscaling" (or keep tagline but drop "film"). email.py:442 "uploading game film" -> "adding your game video". index.astro:99 "Upload your video(s)" -> "Add your game video". Also index.astro:207 "two-hour game file" -> "two-hour game video".

**A5 (P1) APP-MISMATCH. Pricing unit "plays" vs the app's use of "play" for the marked moment, and "credit per second of finished video" vs app label "Video generation".**
- index.astro:395 "A typical play uses ~N", :421 "~{n} plays" large type on every credit pack, :448 "Play counts are estimates". In the app a "play" is a marked moment (free to mark; you pay when you generate/upload/store). The card says plays but billing is per second of finished video plus storage (index.astro:446, site.ts:101). Credit history uses "Video generation", "Game upload", "Clip upload", "Footage added to a game".
- Why: parent thinks buying N plays = N marked plays; a 40-second play costs ~40 credits, not "1 play".
- Rewrite: "~{n} highlights" (finished) and "A typical highlight uses ~N credits". Make credit history labels use the same noun ("Highlight generation").

**A6 INCONSISTENT. "Three steps" vs "Four steps" vs "three-step process".** index.astro:207 "Three steps"; index FAQ index.astro:49 "Three steps"; how-it-works.astro:87 "Four steps" and meta title/description (:77 "four steps"); llms.txt.ts:74 "the three-step process in detail" (links to how-it-works, which has 4). Rewrite: pick one count, 4 (Add game / Mark plays / Frame and spotlight / Share) or restate the home page as 4.

**A7 INCONSISTENT. Naming of the framing step.** "Frame" (header verb, app), "Framing" (tutorials.ts), "Elevate" (index), "Frame & highlight" (how-it-works.astro:144), "Frame and spotlight your player" (how-it-works.astro:25), "put the focus on your athlete" (index.astro:110), "keep the focus on my player" (FAQ index.astro:57), "AI focus" (site.ts:36). "Focus" is a retired name (CLAUDE.md T9860) but survives: site.ts:36, index.astro:57,110, backend detection.py:344/391 "Export from Focus mode first".
Rewrite: "Frame" only. site.ts:36 -> "You frame your athlete; AI smooths, spotlights and upscales" (also see O1).

**A8 INCONSISTENT. "Spotlight" vs "highlight" vs "marker".** Landing: "a spotlight or highlight on your athlete" (useCases.ts:54), "Frame & highlight" (how-it-works.astro:144; here "highlight" means spotlight), "spotlight marker", "player marked or spotlighted". Since "highlight" is also the finished output, the spotlight must never be called "highlight". Backend: "highlight regions/keyframes" (overlay.py:1407,1434), "highlight image" (overlay.py:2181), "poster marker" (overlay.py:2251), "auto/marker cover image" (overlay.py:2309). Rewrite: spotlight everywhere; "cover image" for poster.

**A9 UNCLEAR. "Collection" has opposite meanings.** comparisons.ts:165 "tagged by play type, with a collection for each tag" (here collection = filter of plays). In-app and emails, a collection is a set of finished videos; the landing site never explains combining finished highlights, and the pricing/FAQ never mentions it. Backend also has "Mixes" (collections.py:840,1503, "Mixes.mp4"), "Top Plays", "Game Highlights". Rewrite: reserve "collection" for the combined-video feature; comparisons.ts:165 -> "tagged by play type so you can pull every goal at once". Add one landing line describing collections (or intentionally leave out), and rename "Mixes" to a parent word.

**A10 INCONSISTENT. Players: "player", "athlete", "kid", "child", "skater".** Landing prose swings within one paragraph: "your athlete" (index.astro:271,287), "your player" (how-it-works.astro:25), "your kid" (guides), "your child" (useCases.ts:124), "your son"/"my son" (testimonials). Parent word: "your kid"/"your child"; recruiting pages: "player/athlete" fine. Rewrite: parent pages (index, for-parents, steps) "your kid" or "your player"; keep "athlete" for recruiting. Hockey page uses "skater" (sports.ts:234,237) correct for sport.

**A11 INCONSISTENT. "Frame" is both verb and noun.** "frame your player" and "keep them in frame"/"the frame stops pulsing" (mdx:38) in the same site. Fine, but the guide's "frame rate" and "frame" could be confused; low priority.

### B. Jargon / unclear

**B1 JARGON.** "aspect ratio(s)": index.astro:81 (FAQ), about.astro:114, comparisons.ts:79-80, useCases.ts:168, how-it-works.astro:30; "multiple aspect ratios" -> "wide and vertical versions" (the site elsewhere already says "wide recruiting version and a vertical version for social"). Backend collection titles say "Portrait"/"Landscape" (collections.py:72), a third vocabulary ("vertical"/"wide"/"portrait"/"landscape"). Pick **vertical / wide** (parent words) everywhere.
**B2 JARGON.** "keyframe(s)/keyframed crop": comparisons.ts:67,91,170, mdx:78 "manually keyframing a crop". Rewrite: "adjusting the crop point by point". "codecs", "transcoding" (works-with/[camera].astro:60 "no transcoding step", comparisons.ts:91 "codecs, export settings"), "Re-encoding costs detail" (cameras.ts:52,109,146), "moov windows" (clips.py:3105 raw).
**B3 JARGON.** "AI-proposed player boxes" (index.astro:292, about.astro:100, llms.txt.ts:62, comparisons.ts:218). "motion interpolation between your marks" (index.astro:292). "upscales toward 4K" / "upscaler" (how-it-works.astro:30, cameras.ts:109). Rewrite: "AI suggests who to follow, you pick", "AI makes the zoomed-in picture sharper".
**B4 UNCLEAR.** "Rate them" with no explanation of scale (how-it-works.astro:22); backend auto-names from rating: "Skill miss Goal", "Decision miss Dribble" (constants.py:106-107; queries.py:77). These names appear on shared pages ("clip rail" on game share page, functions/shared/game/[token].js:93-100) and in emails ("{n} highlights"). Why: a coach/parent sees the child's clip labelled "Decision miss". Also unrated yields bare "Goal". Rewrite: labels should not be negative in shared surfaces; suggest not exposing rating words in names or sharing them.
**B5 UNCLEAR. "Elevate/Educate/Celebrate" names are abstract.** (see A1)
**B6 UNCLEAR. "Frame & highlight" and "Under the hood: AI-proposed player boxes, motion interpolation..." (index.astro:292) next to promise "A few drags of the crop box".** Mixed technical and plain registers on same card.
**B7 UNCLEAR. "How long we keep things" (index.astro:452).** Uses "Your uploaded game is kept for 30 days", "Highlights you generate are kept for good", "A draft you haven't generated" (draft undefined). Rewrite with game/play/highlight terms.
**B8 UNCLEAR.** index.astro:446 "Storage 1 credit per GB per 30 days": GB is unknown to many parents; add "(a 90-minute game is about 6 GB)". The worked example exists in the FAQ (index.astro:~75) only.
**B9 JARGON.** "recruiting-ready", "per-player", "capture" ("That solves capture, which was never the hard part", about.astro:238), "ecosystems" (llms.txt:63), "ordinary editing software". About page prose is analyst voice, not parent voice.
**B10 TONE.** Landing guide uses British forms ("centre", "organised", "centred", "standardise", "maths", "storage and battery maths" in mdx headings, comparisons.ts:125 "centred", useCases.ts:189 "organised") for a US-focused product (llms.txt:23 "US-focused"). Also "kit" (useCases.ts:53 "matching kit"), "pitch", "sofa" (useCases.ts:145), "touchline" ("Standing right on the touchline", mdx:34). Rewrite: US spelling and "uniforms/field/couch/sideline".

### C. Overclaims / brand-rule

**C1 (P1) OVERCLAIM / brand rule.** Testimonial: "Really tracked well." (testimonials.ts:42) and "Wow, does the app simulate the camera focusing on my son?" (testimonials.ts:47, used on framing pages). Implies automatic tracking; brand rule forbids. Either drop or show with the user-framed context.
**C2 OVERCLAIM.** site.ts:36 HERO_SUBLINE "AI focus smooths, spotlights and upscales" and hero "Sharp highlight out." with the unmarked claim "In focus" (index.astro:173 `afterLabel="In focus"`). Hero says AI "focus" and "spotlights" (AI does not place the spotlight; the user does). Rewrite: "You frame your athlete and place the spotlight; AI smooths the motion and upscales." (and drop "AI focus").
**C3 OVERCLAIM.** index.astro:60 FAQ 3: "so the finished clip looks like it was filmed close-up on your athlete alone" and "It handles the cutting and generation" / "it handles the cutting and the generation" (index.astro:46, useCases.ts:119). "Cutting" is done by the user's marks; fine, but "handles" can read as automatic. Also index.astro:110 step 3 "You put the focus on your athlete" good; keep.
**C4 OVERCLAIM / CONTRADICTION.** "Generate one highlight in multiple formats" (index.astro:340) and FAQ index.astro:81 "The same highlight can be generated in more than one aspect ratio" vs credit cost "1 credit per second of finished video": each format is a separate paid export. Mention it, or the "same work" claim hides that you pay twice.
**C5 CONTRADICTION.** Free messaging: "Free to start" vs "Make your own free." (functions/shared/*.js: [token].js:209, collection:18-19, game:78, teammate:21-22) vs index.astro:395 "Start with 88 free credits" vs index.astro:254-255 "Free to start. No subscription." vs useCases.ts:226 for-coaches FAQ "How much does it cost? Free to start." (no credit info) vs useCases.ts:107 "Free to start with ReelBallers. Editing services typically charge per reel". "Make your own free" suggests free forever; the product charges credits.
**C6 OVERCLAIM.** "no account required" for viewing OK; but edge share page offers "Download" button (functions/shared/[token].js:306), and index says "plays at full resolution" (index.astro:309, how-it-works FAQ) while og:video is a compressed mp4? Not verifiable here; flag as unverified.
**C7 OVERCLAIM.** about.astro:100 "A framing workflow, backed by AI-proposed player boxes, for keeping a chosen player in frame". "Keeping a chosen player in frame" implies tracking; clarify "you set the frame, the app fills in the motion between your marks".
**C8 CONTRADICTION.** DEFINITION (site.ts:50) says "you mark the best plays and frame your player, and ReelBallers ... generates the highlight" while the email footer (email.py:87) says "ReelBallers helps soccer parents create and share game highlights." and the product supports 11 sports (site.ts:88, sports pages). Rewrite email.py:87: "helps sports parents ...".
**C9 CONTRADICTION.** index.astro:342-343 "Why highlight reels never get made" uses "Watch 10+ hours of game footage" (index.astro:326) but how-it-works says "about as long as watching the game" for marking; keep, but "10+ hours" vs elsewhere "two-hour game" is inconsistent framing.
**C10 TONE.** Hero trust line (site.ts:37) "Free to start. No subscription. Pay only for the AI you use." then index.astro:~252 pricing block heading "No subscription. Pay only for the AI you use." (duplicate on same page, plus FACTS.pricingSummary also repeats). Not an error; repetition.

### D. Backend: emails

**D1 (P1) INCONSISTENT / APP-MISMATCH.** Share emails use five different nouns for one idea: "highlight" (subject "{name} shared a highlight with you", email.py:1008), "video" (same email's footer "shared a video with you", email.py:1023), "game footage" (subject, email.py:1146) vs "a game" (heading, :1147) vs CTA "View Game" (:1160), "game annotations / Watch Annotations" (:1213-1228), "highlight collection" (:877), "game highlights" (teammate, :1094 "shared game highlights with you"), "highlight" with tag: "{name} tagged {tag} in a highlight from {game}" (:1079). Rewrite one scheme: "shared a highlight with you" / "shared a game with you" / "shared marked plays with you" / "shared a highlight collection with you"; CTA "Watch highlight", "Watch game", "Watch plays".
**D2 JARGON.** "annotations" (email.py:1213,1215,1217,1219,1227-1228). Not an app word (app: "Mark play"). Rewrite: "shared the plays they marked from {game}".
**D3 APP-MISMATCH. CTA casing and verbs differ from site/app.** email.py:891,955,1022,1093,1160,1227: "Watch Highlights", "Start Making Highlights", "Watch Highlight", "View Game" (Title Case) vs landing CTAs sentence case ("Start free"). App uses sentence case. Rewrite sentence case.
**D4 TONE/STYLE (P1 bug-like).** OTP email heading `color:#ffffff` on the email's default white background (email.py:515): "Your verification code" is invisible in light clients; also the code colour `#3b82f6` and grey text assume a dark background that the email does not set. Verify rendering; set explicit background or dark text.
**D5 TONE.** OTP subject "Your verification code: {code}" (email.py:538) fine; "Enter this code in the app to sign in. It expires in 10 minutes." (email.py:520) good. 
**D6 INCONSISTENT.** Subject/headings vary between first-touch and later for the same share: first-touch "{name} shared a highlight with you"; later "New shared highlight: {safe_video}" (email.py:1012) (machine tone "New shared ..."), collection "New shared collection: {title}" (:881), teammate "New highlight: {tag} tagged in {game}" (:1083). Rewrite: "{name} shared another highlight: {title}".
**D7 JARGON.** "tagged {tag_name} in a highlight" (email.py:1079-1085): app calls this tag a teammate; the sentence "tagged Maya in a highlight from Game 3" is not clear that Maya is a player, not a label. Rewrite: "{sharer} shared highlights of {player} from {game}".
**D8 UNCLEAR.** Game-ready email (email.py:950-958): subject "{name} is ready - start making highlights" (uses " - "; heading "Your game is ready"; preheader "Your game finished processing - jump back in and start making highlights"). Docstring says "start clipping" (internal). Parent term for the next step is "Mark plays", not "make highlights". Rewrite: "Your game is ready: start marking plays" with CTA "Mark plays".
**D9 TONE.** Welcome email (email.py:438-451) says "uploading game film to downloading a finished highlight" (game film vs "game video"), "reports that help us fix something earn free credits" (fine), signs "Iman Khabazian / ReelBallers" with "From: Iman at ReelBallers". Good copy; only change "game film".
**D10 INCONSISTENT.** Unsubscribe page (email_subscription.py:63-69,98): "Account emails (sign-in codes, shares) still arrive." (uses "shares" for the share emails); "update emails" vs landing/app "release notes/announcements". Fine; tone good. `_not_found`: "Reply to any of our emails and we will remove you by hand." good.
**D11 TONE.** Dev-mode `-- ` in logs only; skip.

### E. Edge share / unfurl pages (functions/shared/**)

**E1 INCONSISTENT.** Single share: title "{name} | ReelBallers"; desc "{name} -- shared from ReelBallers. Make your own free." ([token].js:209,242). Collection: "{title} - shared from ReelBallers. Make your own free." (collection:18-19). Game: "{attribution} -- watch the team recap on ReelBallers. Make your own free." (game:78). Teammate: "{n} highlights from {game} - shared with you on ReelBallers. Make your own free." / "Game highlights shared with you on ReelBallers." (teammate:21-22); og:title "{game} - shared highlights". Four formats; mixed " -- " and " - ". Rewrite one template: "{title}: shared from ReelBallers. Make your own highlights free to start." (also see C5).
**E2 JARGON.** "team recap" (game/[token].js:78, "recap" appears nowhere on landing). "Filmed by {name}'s family" / "Team recap" (:68-69). Rewrite: "Game highlights" / "Filmed by X's family".
**E3 TONE/STYLE.** Brand wordmark "REEL BALLERS" (two words, caps) on game page (game/[token].js:~143) vs brand rule "ReelBallers" (site.ts:20) and "Reel / Ballers" stacked logo elsewhere.
**E4 INCONSISTENT.** Edge CTA labels: "Make your own highlights at www.reelballers.com" (end card, [token].js:302) uses www host and plain text URL; "Open ReelBallers" (:307); "Add this game to your account" (game:153); "Download" (:306). Rewrite: "Make your own highlights" / "Open ReelBallers" / "Add this game". Also `utm_campaign=reel_endcard` (internal, harmless).
**E5 UNCLEAR.** Defaults "Shared Video" (og title when a video has no name, [token].js:202) and "Shared Game" ([token].js game:64, teammate:17) show raw in link previews. Rewrite: "Highlight shared on ReelBallers".
**E6 TONE.** "Tap to unmute" (good, tap), aria "End of video" (fine), "Made With" end-card label capitalization.

### F. Backend: HTTPException detail strings shown to users

Judged shown (frontend does `data.detail` into Error/toast): auth (OtpAuthForm.jsx:160,210), payments (BuyCreditsModal.jsx:194,398,426), share endpoints (ShareModal, ShareGameModal, ShareWithTeammatesModal, SharePlaybackDialog, CollectionShareModal), useRawClipSave (clip errors), usePublishProject, useReEditReel, useWebShare, ClaimGameView, uploadManager, ExportButtonContainer.

**F1 (P1) RAW-ERROR.** Leaks of internal names/tokens: `"Failed to generate R2 URL"` (clips.py:1085,2765,3034; downloads.py:1418; projects.py:1079,1169,1338; framing.py:196 "for working video"; overlay.py:1844), `"R2 returned {status}"` (clips.py:2784,3148; downloads.py:1254,1459; projects.py:1240; games.py:4149; shares.py:1113), `"R2 probe returned {status}"` (downloads.py:1436; projects.py:1192), `"R2 storage not enabled"` (games_upload.py:199,551,999,1061; storage.py:94,157,422), `"Failed to upload clip to R2"` (clips.py:2621), `"Failed to upload final video to R2"` (overlay.py:1700), `"Video {hash} not found in R2. Upload it first."` (games.py:425), `"Invalid BLAKE3 hash format. Expected 64 hex characters."` (games_upload.py:226), `"File size mismatch: expected N, got M"` (games_upload.py:645), `"Failed to initiate multipart upload"` (games_upload.py:439,469), `"Upload completed but object not found"` (:624), `"Game does not use global storage"` (:1081), `"Failed to generate presigned URL"` (:1090; storage.py:124), `"Invalid range"`/`"Requested range outside clip/moov windows"`/`"Malformed Range header"` (clips.py:3070,3105,3114; games.py:4118), `"Working video not found locally: {file}"` (detection.py:391), `"Invalid keyframes JSON: ..."`, `"Invalid segment data JSON"`, `"Invalid multi-clip data JSON"`, `"Invalid overlay_data JSON"`, `"Invalid highlight regions JSON"`, `"Invalid highlight keyframes JSON"` (exports.py:634,645; framing.py:64; multi_clip.py:2141; overlay.py:1407,1434,1656), `"Invalid crop_data in database"` (framing.py:306), `"Failed to stage video"`, `"Failed to copy video"`, `"Overlay generation failed: {e}"` (overlay.py:1622, interpolates exception), `"Failed to load YOLO model: {e}"`, `"ultralytics package not installed. Run: pip install ultralytics"` (detection.py:182-186; likely dev-only), `"Could not reach Google: {e}"` (auth.py:336, interpolates exception), `"Failed to delete user data: {e}"` (auth.py:295), `"GOOGLE_CLIENT_ID not configured"` (auth.py:344), `"Token audience mismatch"` (auth.py:346), `"Email service not configured"` (auth.py:695), `"Payments not configured"` / `"Webhook not configured"` (payments.py:277,327,372,481,889), `"Invalid signature"`/`"Invalid payload"` (payments.py:491,494), `"Session does not belong to this user"` (payments.py:926), `"Invalid credits in payment metadata"` (payments.py:410,932).
Why: a parent sees "R2" / "BLAKE3" / "moov windows" / exception text. Rewrite pattern: "Something went wrong preparing your video. Please try again." for storage/R2; "We couldn't start your upload. Please try again." for multipart; keep technical text in logs. `"Clip uploads are limited to {N}MB. For longer footage, use Add Game instead."` (games_upload.py:248, good, uses app word Add Game).
**F2 (P1) RAW-ERROR / UNCLEAR.** Pending-migration leakage: `"Intro attachment is not available yet for this profile (pending migration)."` (downloads.py:1613), `"The poster marker is not available yet for this project (pending migration). Try again in a moment."` (overlay.py:2251), `"Target profile pending migration; retry shortly"` (downloads.py:2317), `"Rotation is unavailable while your data finishes upgrading — please retry."` (clips.py:750; also uses a literal em dash). Rewrite: "We're updating your account. Please try again in a minute." (one phrase everywhere).
**F3 INCONSISTENT. Terms in error strings** (see A2 list): "Clip not found", "Raw clip not found" (x9), "Working clip not found" (x3), "Project not found" (x18+), "Reel not found", "Download not found" (x9), "Game not found" (x40), "Final video not found", "Working video not found", "Video file not found in storage", "Intro card not found", "Export job not found". Parents see Game/Plays/Highlights/Finished. Rewrite all to "We couldn't find that play / game / highlight" or generic "That item is no longer available."; "Project" is not a user-visible word (app has no "project" noun in the parent flow; the landing never uses it) - clips.py:840,2036,2237,2608 etc. say "Project not found".
**F4 RAW-ERROR.** "No highlights selected" (downloads.py:2071,2412) is user-visible; fine words, but compare "Some highlights cannot be moved." (downloads.py:2105) and "Could not copy highlight media to the target profile. Nothing was moved." (:2165): "target profile" and "highlight media" are internal. Rewrite: "Choose at least one highlight." / "We couldn't move these highlights. Nothing was changed."
**F5 INCONSISTENT / UNCLEAR.** "Storage expired - extend storage to share this game." (games.py:3131,3581): uses " - ", and the landing says "kept for 30 days, and you can extend it anytime" (index.astro:453). OK but unify: "This game's storage has expired. Extend storage to share it."
**F6 JARGON.** "Parental consent is required before attaching an intro card." (downloads.py:1604; collections.py:1256,1563) and "...The parent or guardian must attest to using this player's likeness." (intro_cards.py:207). "intro card" is not mentioned on the landing site at all (APP-MISMATCH: feature absent from marketing). "attest ... likeness" is legal jargon; rewrite: "A parent or guardian needs to confirm they're OK with showing this player in the intro."
**F7 RAW-ERROR.** Validation messages with identifiers: `"Invalid aspect_ratio '...' (expected '9 16' or '16 9')"` (clips.py:1265), `"Invalid aspect ratio ..."` (projects.py:786), `"Invalid layer ..."`, `"Invalid game_type ..."` (games.py:1983,2479), `"offset_seconds must be given for every video or for none"` (games.py:598), `"offset_seconds is only accepted when creating a game"` (:828), `"Send video_sequence either on the request or on every moment, not both"` (suggestions.py:118,125), `"items must be non-empty"` (clips.py:2386), `"items must be a JSON array: ..."` (collections.py:1303), `"game_id and mixes are mutually exclusive"` (downloads.py:295), `"Must provide raw_clip_id"` (clips.py:2228), `"name is required"` / `"no fields to update"` / lowercase `"intro card not found"` (intro_cards.py:224,280,293,350,353; casing differs from every other message), `"state must be 'open' or 'dismissed'"` (suggestions.py:231), `"winner_id and loser_id must differ"` (rank.py:327). Veo import: `"Moment runs to 123s but video 2 is 60s: wrong video?"` (suggestions.py:147) is user-facing in VeoImportSheet and is good in spirit but says "moment" and "video 2".
**F8 TONE.** Rank: `"Reel is not rankable (missing rating -- re-export or backfill)"` (rank.py:349,446): admin-speak ("backfill") if it ever reaches a user.
**F9 INCONSISTENT.** Cancel/retry copy: "This item is being edited by another request. Please try again." (clips.py:512,789; overlay.py:517,1023) and "This clip was edited elsewhere. Refresh to see the latest." (clips.py:400) and "This project was edited elsewhere. Refresh..." (overlay.py:537): "item/clip/project", and "Refresh" (brand/UX rule: UI updates without refresh; owner says never ask to refresh). Rewrite: "This play was changed on another device. We've loaded the latest."
**F10 INCONSISTENT. Export/Generation words inside the same flow.** "Starting generation..." (framing.py:238, multi_clip.py:2112), "Starting multi-clip generation..." (multi_clip.py:2086), "Starting overlay generation..." (overlay.py:1368), "Export complete!" (multi_clip.py:1948; overlay.py:1458,2579; exports.py:1183), "Multi-clip export complete!" (multi_clip.py:1635), "Export complete (no overlay effect)" (overlay.py:2879), "Export complete (test mode)" (:2954), "An export for this clip is already running." (framing.py:236, multi_clip.py:2106, overlay.py:2672), "Generation failed: {e}" (multi_clip.py:2549-2550, interpolates exception), "Export failed: {error_msg}" (exports.py:1199), "Connection lost but job may still be running. Refresh to check status." (multi_clip.py:1522), "Export is finalizing (recovered by a concurrent request) -- check back shortly." (:1622), "Render finished, finalizing" (exports.py:1016), "Local export completed", "Modal job is still processing" (exports.py:1042), "Failed to retrieve Modal job" (:986). Landing says "Generate" ("Generate and share one link", index.astro:109) and credits history says "Video generation". Rewrite: "Generating your highlight..." / "Your highlight is ready!" everywhere; remove "Export", "Modal", "job", "multi-clip", "overlay", "Refresh", "recovered by a concurrent request".
**F11 JARGON.** Progress strings "Validating project...", "Processing clip 2/5...", "Extracting clip 3/5...", "Downloading clip 3/5...", "Concatenating clips...", "Uploading to cloud storage...", "Copying video...", "Processing video..." (framing.py:223; multi_clip.py:1748,1807,1855,2372,2417; overlay.py:1448,2826,2659). Frontend routes some through `exportProgressLabel` (GlobalExportIndicator.jsx:28), so partially mapped; remaining pass-through strings need the same mapping. Rewrite: "Preparing...", "Sharpening play 2 of 5...", "Putting your highlight together...", "Saving...".
**F12 RAW-ERROR (GPU).** `"CUDA not available - GPU required for AI upscaling"`, `"GPU out of memory - try closing other GPU applications: {e}"`, `"CUDA error - GPU may be busy or unavailable: {e}"`, `"AI SR model failed to load"`, `"AI upscaling dependencies not installed"` (multi_clip.py:1096,1110,1684,1712,1719,1726). These are local-dev messages, but if surfaced in prod they tell a parent to close GPU apps. Rewrite generic.
**F13 TONE.** `"Multi-clip render not yet supported. Use the standard export for multi-clip projects."` (framing.py:289), `"Project has no clips to export. Add clips first."` (framing.py:283): uses "Project", "export", "multi-clip", "Add clips" none of which match the app's Mark play/Frame/Finished language.
**F14 INCONSISTENT.** Auth/OTP messages are good, plain English: "Too many codes requested. Please try again later." (auth.py:669), "Code expired. Please request a new one." (:735), "Invalid code. 2 attempts remaining." (:751). But ends inconsistently: "Please try again tomorrow." (:628) vs "try again later". Minor.
**F15 UNCLEAR.** `"No Session"`, `"Invalid or expired session"` (auth.py:535,546): shown at sign-in; rewrite "Your session ended. Please sign in again."
**F16 TONE.** Literal em dashes in backend strings that can reach users: clips.py:750; `" -- "` double hyphen (multi_clip.py:1622; overlay.py:2300 "no exported final video yet -- nothing to revert"; rank.py:349). Welcome/OTP copy rules (email.py:425-428) say "no em dashes", so these violate the same rule.

### G. Server-generated names

**G1 (P1) TONE/APP-MISMATCH.** Default names visible to users/recipients: "Untitled", "Untitled Game", "Untitled Highlight", "Clip {id}" (clips.py:1200,1202), "Game {id}" (collections.py:474,526,1497; downloads.py:430), "Highlights" (collections.py:845,1402; email.py:878 `collection_title or "Highlights"`), "Top Plays" (collections.py:1503), "Mixes" (collections.py:840,1503). "Clip {id}" exposes an internal id to the parent; "Mixes" is jargon. Rewrite: "Play at {m:ss}", "Game on {date}", "My highlights".
**G2 INCONSISTENT.** Download file names: single `{Name}_ReelBallers.mp4` (downloads.py:694), fallback `video_ReelBallers.mp4` (:687), collection `Game_Highlights.mp4`, `Mixes.mp4`, `{tags}.mp4`, `Highlights.mp4` (collections.py:835-846), privacy export `reelballers-data-export-{id}.json`. Rewrite: all `{Title}_ReelBallers.mp4`; fallback "highlight_ReelBallers.mp4".
**G3 INCONSISTENT.** Collection titles: `"{Game} Game Highlights - Portrait (0:30)"` (collections.py:1495-1510) uses "Game Highlights" and "Portrait"/"Landscape" (RATIO_WORD at :72), while landing says "vertical/wide". "Top Goals"/"Top Plays": uses "Plays" as the finished item. Double "Game" when the game name already contains it. Rewrite: "{Game}: highlights (vertical)".
**G4 TONE (P1).** Rating-based default names: constants.py:102-108: "Brilliant", "Good", "Interesting", "Skill miss", "Decision miss" produce names like "Skill miss Goal" and "Decision miss Dribble and Assist" (queries.py:77). Negative judgment words are attached to a child's play and later reach share pages and collections. Also grammar oddity "Skill miss Goal". Rewrite: no negative adjectives in default names.

### H. Landing: style and small things

**H1 TONE/STYLE.** `--` as a dash appears about 127 times in visible landing prose, e.g. index.astro:25 comment? visible: FAQ answers (index.astro:60,64), `Upload the video you already filmed -- a full game or a single clip` (how-it-works.astro:18), `highlight ... -- wide for recruiting or vertical for social` (sports.ts:90), `Export the full match rather than only ... -- the auto-cut` (cameras.ts:50). Rendered as two hyphens in HTML (no smart-dash). The owner's rule is no em dashes in shipped copy; "--" is the substitute but reads as a typo. Rewrite: a period, a comma, or a colon.
**H2 INCONSISTENT.** Title patterns: "Soccer Highlight Video Maker | ReelBallers" (sports.ts:64) vs "Edit Trace Footage Into a Highlight Reel" (cameras.ts:41) vs "Highlight Reels for Sports Parents | ReelBallers" (useCases.ts:114) vs "Highlight Video for Sports Clubs | ReelBallers" (useCases.ts:233) vs flag football "Highlight Reel Maker" (sports.ts:127). Use one noun.
**H3 INCONSISTENT.** Casing in headings: "Request it" vs "Get started free" vs "Start free" vs "See how it works" vs "Most Popular"/"Best Value" (Title Case, index.astro:412,417) vs sentence case elsewhere.
**H4 UNCLEAR.** "How credits work" button (index.astro:442) links to `#faq` which scrolls to a long list; the answer to "How much does it cost?" sits there but no heading named "credits". Rewrite: a short "What is a credit?" block.
**H5 UNCLEAR.** CTA verb/noun: "Start free", "Get started free", "Get started free" in Cta.astro:54 and Header.astro:40, "Watch the tutorial" (index.astro:~149) and "Watch the full tutorial on YouTube" (:~254). Fine; unify to "Start free".
**H6 TONE.** index.astro:208ish "Three steps from a two-hour game file to a highlight you can send to anyone." Good; only "file".
**H7 JARGON.** Testimonial attribution "ReelBallers user" and quote "Clutch!" (testimonials.ts:51): slang is fine; but "create a reel based on options like games and stars" (testimonials.ts:30) uses "stars" = app rating, "games" = tabs; matches the app (good) yet the landing never explains ratings.
**H8 JARGON.** Footer "Do Not Sell or Share" (Footer.astro:147) legal. OK.
**H9 UNCLEAR.** 404 page: "The link may be out of date. Here is everything else." (404.astro:23) good; description uses "highlight reel guides" (404.astro:14).
**H10 INCONSISTENT.** FAQ phrases the same Q three ways: "What does the person I share the highlight with need?" (index.astro:~78), "What does the person receiving the highlight need?" (how-it-works.astro:56), "What does the person I send the highlight to need?" ([sport].astro:~190). Fine, but "share/send/receive" varies; app verb: "Share".
**H11 UNCLEAR.** `Under the hood` note (index.astro:292) and "Request it" link (index.astro:362) mailto subject "New sport request": OK.
**H12 INCONSISTENT. Time/length claims.** "Roughly the length of the game" for marking (how-it-works.astro:37; for-parents FAQ useCases.ts:160) vs "a few drags per clip" (how-it-works.astro:37) vs "in minutes" tagline (site.ts:27, "Transform ... in minutes"). Marking a 2-hour game takes ~2 hours, so "in minutes" is contradicted by the site's own FAQ. Rewrite tagline to "a highlight in minutes after you mark the plays" or drop "in minutes".
**H13 INCONSISTENT.** "Free to start. No subscription." vs FAQ "88 free credits" (FACTS.freeCredits) vs the cost to store a game ("storing an uploaded game costs credits too", index.astro:~72): first game upload may consume the free credits; free pitch omits it in the hero.
**H14 STYLE.** Landing mentions "tag teammates" (index.astro:271, how-it-works.astro:138) but the app's concept is "player tags"/teammate sharing; edge page uses "player_tags". Rewrite: "tag the players in each play".
**H15 UNCLEAR.** Recruiting page checklist uses "clips" for the parts of the reel (useCases.ts:71-72 "The player marked or spotlighted at the start of every clip"; "Each clip starts a beat before the play develops") - here clip means a segment within the recruiting video, a fourth meaning. Fine in context but note for the glossary decision.

### I. Cross-surface summary (app words vs outside words)

| Concept | App | Landing | Email/edge/backend |
|---|---|---|---|
| marked moment | play | play / clip / moment / draft | clip / raw clip / working clip / highlight / annotation / moment |
| finished single | highlight/Finished | highlight reel / highlight / highlight video / finished clip | highlight / video / reel / final video / download |
| combined | collection / reel | (not explained; "collection" used as tag filter) | collection / Mixes / Top Plays / Game Highlights |
| steps | Add Game, Mark play, Frame, Spotlight | Educate/Elevate/Celebrate; Annotate; Frame & highlight; Upload/Mark/Generate | Focus mode; Overlay; export; generation |
| vertical/wide | (app) | vertical / wide / aspect ratio | portrait / landscape / 9:16 |
| source | Game | game film / footage / video(s) / game file | game / game footage / video |
