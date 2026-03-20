# T600: Auto-Generate Annotation Titles from Notes (TF-IDF)

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-03-20
**Updated:** 2026-03-20

## Problem

Annotations/clips don't have auto-generated titles. Users write coaching notes like "I love how close you are covering your man" but must manually create a title. This friction means most clips end up untitled or with generic names, making them harder to find and organize.

## Solution

Use TF-IDF keyword extraction (scikit-learn) to auto-generate short titles from annotation notes. The vectorizer is fitted on the user's corpus of notes, so titles improve as the user adds more annotations. Zero cost — runs on the server with minimal CPU/memory, no external API calls.

**Examples:**
- "I love how close you are covering your man" → **"Covering Close Man"**
- "Land that ball on the outside, somewhere Nico can make a play" → **"Ball Outside Nico Play"**

### Approach

1. **Backend:** Add a TF-IDF title generation utility using scikit-learn
   - Fit vectorizer on the user's existing notes corpus (all annotation notes for that user)
   - Extract top 3-4 keywords by TF-IDF score, title-cased
   - If corpus is too small (< ~5 notes), fall back to stop-word removal + first N content words
2. **Backend endpoint:** Generate title when a note is saved/updated
3. **Frontend:** Auto-populate title field from generated title (user can override)

### Key Design Decisions

- **Per-user corpus:** TF-IDF is fitted per-user so sport-specific jargon and player names surface correctly
- **Fallback for small corpus:** With < 5 notes, TF-IDF can't distinguish common vs. rare terms — use simple stop-word filtering instead
- **User override:** Generated title is a suggestion, never overwrites a manually-set title
- **scikit-learn only:** No ML models, no GPU, no external APIs. TfidfVectorizer is pure CPU, ~50MB memory footprint shared across requests

## Context

### Relevant Files (REQUIRED)
- `src/backend/requirements.txt` - Add scikit-learn dependency
- `src/backend/app/` - New utility for TF-IDF title generation
- Backend annotation/clip endpoints - Hook in title generation on note save
- Frontend annotation components - Display generated title, allow override

### Related Tasks
- None

### Technical Notes
- scikit-learn is a well-established, lightweight library — no heavy ML models
- TfidfVectorizer fits in memory trivially for per-user corpora (hundreds to low thousands of notes)
- On Fly.io: adds ~50MB to container image, negligible per-request CPU
- Title generation should be synchronous — TF-IDF on small corpora is sub-millisecond

## Implementation

### Steps
1. [ ] Add scikit-learn to backend requirements
2. [ ] Create TF-IDF title generation utility (fit on user notes, extract keywords)
3. [ ] Add fallback for small corpus (< 5 notes: stop-word removal + truncation)
4. [ ] Hook title generation into annotation/clip note save endpoint
5. [ ] Frontend: auto-populate title from backend response, preserve manual overrides
6. [ ] Test with real coaching notes

### Progress Log

*(none yet)*

## Acceptance Criteria

- [ ] Saving a note auto-generates a 2-5 word title from keywords
- [ ] Generated title uses TF-IDF when user has >= 5 notes, simple extraction otherwise
- [ ] User can manually set/override the title — auto-generation never overwrites manual titles
- [ ] No external API calls, no GPU usage
- [ ] Works on Fly.io without impacting scaling (no persistent in-memory state between requests)
