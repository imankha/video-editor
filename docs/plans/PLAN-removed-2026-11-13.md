# Rows removed from PLAN.md on 2026-11-13

Owner request 2026-11-13: review every row of Chores, Later and the July audit refactors against today's code, move what is worth doing to the top, and delete the rest. Each row below was checked against the code that day. The task files were deleted; their text is in git history before this commit. Nothing here is parsed by the task board, the roadmap export or dotask.

| ID | Reason |
|------|------|
| T3440 | Already done: the server sends the preflight cache header (`max_age=86400` in the CORS setup in `src/backend/app/main.py`). |
| T13760 | Already done as T13950: Branch CI runs only the app tests related to a change. |
| T4650 | Already done by T4270: the bulk annotation save and its endpoint no longer exist. |
| T10640 | The stale Export locator was fixed under T11720. The same spec's Spotlight half is still stale and is now part of T11905. |
| T13750 | Branch protection conflicts with how this repo works: plan edits and /dotask bug filings go straight to master (274 direct commits in two weeks). With an owner bypass it stops nothing; without one it breaks that flow. |
| T7140 | Its premise is out of date: the app already moves the video index to the front during upload. What is left, the server never checking, is T2580. |
| T447 | Works only in an installed app on Chrome for Android and needs push notifications that never shipped. 'Upload does not die' is owned by the big-file upload section (T15840); when that task is written up, 'resumes when the phone is unlocked or the tab returns' belongs in its done-when. |
| T448 | Installed Android app only. It removes a file-picker step, not a measured loss; the measured loss, no file on this device, was fixed by T14810. |
| T7440 | The channel read-out, country, sharer code and attribution gates are all live on the admin Journey. What remained was a monthly narrative and a CSV for an investor hand-off nobody has scheduled. |
| T7460 | Superseded by the spend-readiness gates (T14910) and the retention chart (T7430, T16070). Its targets would read 'insufficient data' at 17 returning users. |
| T7467 | The admin Builds table already slices the funnel by build. A before-and-after view at day granularity on 30 to 40 sign-ups a week would nearly always be suppressed for small numbers. |
| T7450 | Counts repeat use of collections and ranking for a population of 17 returning users, with no admin screen that would read the events. The retention chart answers 'did they come back'. |
| T7455 | T11175 moves the Frame and Spotlight open events off the quest system, which was the substance of this task. Per-open counts with clip ids have no reader. |
| T7160 | Deferred since 2026-09-17 with four open design questions; tile previews on Home move no funnel stage, and the reel builder will define tap behaviour on the same tiles. |
| T11340 | Dead: it split a multi-clip export across GPUs, and multi-clip export is being removed (T11250). It was also designed around a GPU function nothing calls. If one long clip ever nears the time limit, file a fresh task. |
| T11350 | A GPU cost saving that still needs a calibration run nobody has scheduled; its only incident was a 14-clip export, which no longer exists. The cheap-path decision belongs to the upscaler routing task (T4740). |
| Session Scaling epic | No measured problem: production is pinned to one server. |
| T2250 | Edits that do not need to be durable already sync after the response (T3250). The rest is storage request cost at a scale we do not have, bought with a three-minute data-loss window. |
| T2260 | Exists only to cover the data-loss window T2250 would have opened. |
| T40 | A new sign-in already signs other devices out. What was left was a 'signed in elsewhere' notice with no report asking for it. The security half is T16490. |
| T1537 | Optimised a quest request that T11175, T11180 and T11185 delete. |
| R2 CDN epic | Its latency case was disproved by measurement (video starts in 266 ms) and its cost case needs a scale 402 users do not have. |
| T2550 | No code exists and no problem it would fix is measured. |
| T2570 | Three of the four video proxy endpoints are live primary paths, so the task as written was unsafe. The one unused endpoint is deleted by T16500. |
| Movement Tracking epic | Its goal, sparing parents the 90-minute scrub by showing dead time, is met more directly by Mark plays with AI, which returns the plays themselves from a working prototype. This epic was still an unstarted eight-game labelling project. |
| T7060 | Movement Tracking epic removed. |
| T7070 | Movement Tracking epic removed. |
| T7080 | Movement Tracking epic removed. |
| T5460 | Movement Tracking epic removed. |
| T5470 | Movement Tracking epic removed. |
| T5480 | Movement Tracking epic removed. |
| T5490 | Movement Tracking epic removed. |
| Game Pools epic | Needs two families filming and sharing one game; six users have ever shared anything. No child stands alone: the per-half control is already gone and the dropzone already takes a camera folder, and landing big 4K files is owned by the big-file upload section. |
| T5495 | Game Pools epic removed. |
| T5498 | Game Pools epic removed. |
| T5500 | Game Pools epic removed. |
| T5510 | Game Pools epic removed. |
| T5520 | Game Pools epic removed. |
| T5530 | Game Pools epic removed. |
| T5540 | Game Pools epic removed. |
| T5550 | Game Pools epic removed. |
| T7300 | Game Pools epic removed. |
| T7310 | Game Pools epic removed. |
| T5560 | Game Pools epic removed; it also depended on Movement Tracking. |
| Overlay 3 epic | Decorative Spotlight effects with no evidence behind them: the parents who return are the ones who finish Spotlight, not ones asking for more effects. Its player-label idea is covered by the reel title card (T15880). |
| T2100 | Overlay 3 epic removed. |
| T2120 | Overlay 3 epic removed. |
| T2150 | Overlay 3 epic removed. |
| T710 | The coach-facing outcome ships as a reel link with a view count and no coach account (T15880). A coach account with rosters needs coaches and sharing behaviour that six sharers do not show. |
| Export Write-Path Unification epic | Its two remaining tasks, T4400 and T4410, were re-scoped on today's code and stand alone. |
| Keyframe System Unification epic | Only its deletion task, T4440, survives review. |
| Editor State Decoupling epic | T4470, T4480 and T4490 survive review and stand alone. |
| T4450 | The 'cannot delete the first keyframe' bug lives only in dead code that T4440 deletes. The two live keyframe renderers have different shapes; merging two is premature. |
| T4460 | Spotlight circles and Frame crops are different data models; moving one onto the other's controller is a new abstraction with one user. The fixed 30 frames a second in Spotlight matches the server and is not a bug. Refile if a snapping bug is reported. |
| T4500 | The stale-name bug cannot happen: the project is re-read on every open and rename exists only on Home. |
| T4510 | Large and risky on the first screen a new parent uses, with no bug it would fix; request de-duplication already removed part of the reason. |
| T4520 | Of ten listed items three are fixed, two are deleted by T4440 and one by T11270. The four left are small style points with no bug. |
| T4530 | Overtaken: tests that mount the Frame and Spotlight screens directly now exist. |
| T4590 | Speculative: it prepared for a second undo system, which has since been built separately and works differently. |
| T4600 | Its premise was wrong: plays may overlap, Spotlight regions may not, and Frame cuts are boundaries. The shared code is tens of lines. |
| T4580 | The three playback hooks have deliberately diverged (one avoids a bug another has), and the reel builder will define its own playback. |
| T4630 | Two of the four video proxies already share the faster client and the app mostly plays direct storage links now. The one unused proxy is deleted by T16500. |
