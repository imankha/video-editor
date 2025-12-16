# Player Highlighter - Development Plan

**Product**: Browser-based video editor for creating soccer highlight clips
**Development Context**: Solo development using Claude Code
**Approach**: AI-first documentation, risk-first development, iterative phases

---

## Product Vision

A specialized video editor that helps soccer content creators produce professional highlight clips by:
1. **Framing Mode**: Crop, trim, and speed-adjust raw game footage to follow the action
2. **Overlay Mode**: Add visual effects that help viewers appreciate the player's skill (highlights, text, ball effects, tactical visualizations)
3. **AI Upscaling**: Enhance output quality with super-resolution models

The workflow is: **Upload** → **Frame** → **Overlay** → **Export**

---

## Current State (November 2025)

### Completed Features

| Feature | Status | Description |
|---------|--------|-------------|
| Video Loading | COMPLETE | Drag & drop, file validation, metadata extraction |
| Video Playback | COMPLETE | HTML5 player, controls, frame-accurate seeking |
| Crop Keyframes | COMPLETE | Animated cropping with interpolation, aspect ratio presets |
| Speed Regions | COMPLETE | Segment-based speed control (0.1x to 10x) |
| Trimming | COMPLETE | Segment-based trim from start/end, de-trim |
| Export Pipeline | COMPLETE | FFmpeg encoding with crop/speed/trim applied |
| Framing Mode | COMPLETE | Full crop + trim + speed workflow |
| Overlay Mode | COMPLETE | Highlight layer with keyframes (basic) |
| AI Upscaling | EXPERIMENTAL | HAT/SwinIR models, RIFE frame interpolation |

### Architecture

```
src/
├── frontend/                 # React 18 + Vite + Tailwind
│   └── src/
│       ├── modes/
│       │   ├── framing/      # Crop + Segments + Speed
│       │   └── overlay/      # Highlight effects
│       ├── components/       # Shared UI components
│       ├── hooks/            # State management hooks
│       └── utils/            # Utilities & algorithms
│
└── backend/                  # FastAPI + Python
    └── app/
        ├── routers/          # API endpoints (export, health)
        ├── ai_upscaler/      # Super-resolution models
        └── interpolation.py  # Crop keyframe interpolation
```

---

## Phase Structure

### COMPLETED PHASES (Reference Only)

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation | COMPLETE |
| 2 | Crop Keyframes | COMPLETE |
| 3 | Import/Export | COMPLETE |
| 4 | Speed Controls | COMPLETE |
| 5 | Trimming | COMPLETE |

See individual phase docs for implementation details (useful as reference for similar features).

---

### ACTIVE DEVELOPMENT PHASES

#### Phase A: Overlay Improvements (NEXT PRIORITY)
**Goal**: Enhanced overlay system with AI-assisted player tracking, ball effects, and text overlays

**Features**:

| Feature | Description |
|---------|-------------|
| **Click-to-Track Highlights** | Click on player → YOLO detects → ByteTrack tracks → keyframes auto-generated |
| **Default 5s Duration** | Highlight regions now default to 5 seconds instead of 3 |
| **3 Keyframes/Second** | Auto-generated keyframes at 3 per second for smooth tracking |
| **Duration Re-Tracking** | Changing region duration re-runs tracking algorithm |
| **Manual Override** | User can still manually edit/delete keyframes |
| **Ball Brightening** | YOLO ball detection with adjustable brightness slider |
| **Text Overlays** | Add animated text labels (player names, stats, etc.) |

**Why Important**: Click-to-track dramatically simplifies the highlight workflow. Ball brightening and text overlays round out the overlay toolset.

---

#### Phase B: Clipify Mode (THEN)
**Goal**: New workflow mode for extracting clips from full game footage

**Features**:
- New "Add Game" button alongside "Add Clips" in no-videos state
- Import full game video into Clipify mode (pre-framing workflow)
- Define clip regions with description metadata
- Region levers to set start/end boundaries for each clip
- Export creates individual clip files with embedded metadata
- Files named: `{original}_{start_timestamp}_{end_timestamp}.mp4`
- After export, clips auto-load into Framing mode

**Workflow**:
```
[Add Game] → Clipify → Export Clips → Framing (with clips) → Overlay → Export
```

**Why Important**: Users often start with full game footage. Clipify provides a streamlined way to extract the moments they want to highlight.

---

#### Phase C: Deployment (FINALLY)
**Goal**: Production deployment with Cloudflare + RunPod

**Infrastructure**:
- Frontend: Cloudflare Pages (static React/Vite)
- Edge API: Cloudflare Workers
- Database: Cloudflare D1 (wallet/credits)
- Storage: Cloudflare R2 (video files)
- GPU Compute: RunPod (AI upscaling jobs)
- Payments: Stripe (prepaid credits)

**Environments**:
| Environment | Purpose | Backend |
|-------------|---------|---------|
| Local | Fast development | Local Python/FFmpeg |
| Staging | Integration testing | Cloudflare + RunPod (test) |
| Production | Live users | Cloudflare + RunPod (prod) |

**Build Scripts Needed**:
- `npm run build:local` - Development mode
- `npm run build:staging` - Deploy to staging
- `npm run build:prod` - Deploy to production

See `cloudflare_runpod_deploy_package/` for Terraform and Wrangler configs.

---

## Key Technical Decisions

### What's Included
- Single video track (multi-clip on one track)
- Sequential clip arrangement (no overlap)
- Keyframe-based animation for all effects
- FFmpeg for video processing
- AI upscaling as optional enhancement

### What's NOT Included (Scope Limits)
- Multi-track timeline (audio separate from video)
- Complex transitions (keep it simple: cut, fade)
- Real-time collaboration
- Cloud storage of projects (local-first)
- Undo/redo (not prioritized)

### Development Environment
- Local Python backend for fast iteration
- Deployment abstracted to later phase
- Single browser testing during development

---

## Success Criteria

### Phase A (Overlay Improvements)
- [ ] Default highlight duration is 5 seconds
- [ ] Click on video detects players via YOLO
- [ ] Click on detected player initiates ByteTrack tracking
- [ ] Keyframes auto-generated at 3 per second
- [ ] Ellipse follows tracked player during playback
- [ ] Duration change re-generates auto keyframes
- [ ] Manual keyframes preserved on duration change
- [ ] Ball detection runs and identifies ball
- [ ] Ball brightness slider adjusts brightness level
- [ ] Ball brightening visible in preview and export
- [ ] Text overlay can be added with content
- [ ] Text can be positioned, styled, and animated
- [ ] Text appears correctly in export

### Phase B (Clipify Mode)
- [ ] "Add Game" button visible alongside "Add Clips"
- [ ] Full game video imports into Clipify mode
- [ ] Can add clip regions at playhead
- [ ] Can adjust region boundaries with levers
- [ ] Can add description to each clip
- [ ] Export creates individual clip files
- [ ] Files named with timestamp convention
- [ ] Metadata embedded in clip files
- [ ] Clips auto-load into Framing after export

### Phase C (Deployment)
- [ ] Staging environment deployed
- [ ] Production environment deployed
- [ ] Stripe integration working
- [ ] RunPod GPU jobs executing
- [ ] Instant video download working (no long-term storage)

---

## File Structure

```
docs/
├── 00-PROJECT-OVERVIEW.md          # This file
├── README.md                        # Quick reference
├── QUICK_START.md                   # Development setup
├── TECHNICAL-REFERENCE.md           # Patterns & algorithms
├── AI-IMPLEMENTATION-GUIDE.md       # AI coding workflow
│
├── COMPLETED/                       # Reference docs for completed features
│   ├── 01-PHASE-FOUNDATION.md
│   ├── 02-PHASE-CROP-KEYFRAMES.md
│   ├── 03-PHASE-IMPORT-EXPORT.md
│   ├── 04-PHASE-SPEED-CONTROLS.md
│   └── 05-PHASE-TRIMMING.md
│
├── ACTIVE/                          # Current development specs
│   ├── PHASE-A-OVERLAY-IMPROVEMENTS.md  # Click-to-track, ball, text overlays
│   ├── PHASE-B-CLIPIFY.md               # Clipify mode for game footage
│   └── PHASE-C-DEPLOYMENT.md            # Cloudflare + RunPod
│
└── REFERENCE/                       # Supplementary docs
    ├── AI-UPSCALING.md
    └── SR_MODEL_TESTING.md
```

---

## Notes for AI Implementation

Each phase spec includes:
- Exact component requirements
- Complete data models (TypeScript interfaces)
- Algorithm specifications (pseudocode)
- API contracts
- Testing requirements
- Acceptance criteria

Specs are written to minimize ambiguity and maximize implementation success with AI coding assistants.

**Prompting Strategy**:
1. Read the phase spec fully
2. Identify the smallest implementable unit
3. Implement incrementally with tests
4. Validate against acceptance criteria
5. Move to next unit

---

## Quick Links

- **Start Here**: [README.md](README.md)
- **Setup**: [QUICK_START.md](QUICK_START.md)
- **Technical Details**: [TECHNICAL-REFERENCE.md](TECHNICAL-REFERENCE.md)
- **Deployment Plan**: `cloudflare_runpod_deploy_package/README.md`
