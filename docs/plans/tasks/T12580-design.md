# T12580 design (implemented under the 2026-10-12 rulings; no separate approval round was possible in the headless run)

- Two states per guide step: Focused (dialog + shade, "Got it") and Free (acknowledged). Ack set lives in `guideFocusStore.js` (zustand, memory only, keyed by rule id => "once per rule", ruling 2). `settingsStore.setCoachEnabled(true)` clears it.
- Shade: one fixed div in the `FloatingCoach` portal, `bg-black/40 backdrop-blur-sm backdrop-brightness-75`, `clip-path: path(evenodd, ...)`. Clip-path also clips hit-testing, so holes pass clicks and the rest swallows them; a tap on the shade does nothing (ruling 5). Holes = anchor + rule `keepClear` selectors + the Guidance switch (rulings 3, 4), padded 6px and unioned (`mergeRects`).
- No shade (dialog only) for tone `progress`/`error` (ruling 1), off-screen anchor (scroll chevron stays, user never trapped), no resolved anchor rect, or an open modal layer.
- "Got it" is rendered by `InstructionCoach` from `GuideFocusContext` (provided by `FloatingCoach`), so inline coaches and the Focus `FramingGuide` chip both work. Esc acknowledges. No `role=dialog`/`aria-modal` (BLOCKING_LAYER); focus moves to "Got it" explicitly.
- Watch steps (`annotate.watch`, `annotate.watch.playing`, `focus.progress.play`, `focus.progress.watchPreview`) carry `keepClear` for the video stage.
- Guidance off: `FloatingCoach` returns null: no shade, observers or listeners. Nothing persisted.
