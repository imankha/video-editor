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

#### Phase A: Multi-Clip + Transitions (NEXT)
**Goal**: Support multiple video clips in Framing mode with transitions

**Features**:
- Import multiple video files
- Clip layer shows each clip as a region
- Drag to reorder clips on the timeline
- Click between clips to set transitions (cut, fade, dissolve)
- Per-clip crop keyframes, speed regions, and trim
- Delete unwanted clips

**Why Important**: Users often have multiple angles or segments they want to combine into a single highlight.

---

#### Phase B: Overlay Mode Expansion (THEN)
**Goal**: Rich overlay system for soccer-specific visualizations

**Planned Overlay Types**:

| Type | Description |
|------|-------------|
| Highlight (existing) | Elliptical spotlight with brightness/color effects |
| Text | Labels, player names, stats, timestamps |
| Ball Effects | Brightness boost on ball, motion blur trails |
| Scan Indicator | Show when dribbler looks up (head movement) |
| Space Visualization | Show space created by dribble/movement |
| Defender Markers | X marks on beaten defenders |
| Through Ball Lines | Show passing lanes and beaten defenders |

**Architecture Goals**:
- Common interface for all overlay layer types
- Click-to-edit properties dialog (not in main UI)
- Per-layer: visibility toggle, opacity, z-order
- Keyframe animation for all layer types
- Consistent add/edit/delete workflow

**Why Important**: These visualizations are the core value proposition - they help viewers appreciate the soccer skill being demonstrated.

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

### Phase A (Multi-Clip)
- [ ] Can import multiple videos
- [ ] Clips shown as regions on clip layer
- [ ] Can drag to reorder clips
- [ ] Transitions render correctly in export
- [ ] Per-clip effects (crop/speed/trim) work

### Phase B (Overlay Expansion)
- [ ] Common layer interface working
- [ ] At least 3 overlay types implemented
- [ ] Properties dialog for layer editing
- [ ] Keyframe animation for all layers
- [ ] Export includes all overlay effects

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
│   ├── PHASE-A-MULTI-CLIP.md
│   ├── PHASE-B-OVERLAY-EXPANSION.md
│   └── PHASE-C-DEPLOYMENT.md
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
