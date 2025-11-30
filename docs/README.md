# Player Highlighter - Documentation

AI-optimized documentation for building a soccer highlight video editor.

---

## Quick Navigation

| Document | Purpose |
|----------|---------|
| [00-PROJECT-OVERVIEW.md](00-PROJECT-OVERVIEW.md) | Start here - vision, current state, roadmap |
| [QUICK_START.md](QUICK_START.md) | Development environment setup |
| [TECHNICAL-REFERENCE.md](TECHNICAL-REFERENCE.md) | Patterns, algorithms, architecture |
| [AI-IMPLEMENTATION-GUIDE.md](AI-IMPLEMENTATION-GUIDE.md) | Tips for AI-assisted development |

---

## Current Development Focus

### Phase A: Multi-Clip + Transitions (NEXT)

Support multiple video clips in Framing mode with transitions.

**Spec**: [ACTIVE/PHASE-A-MULTI-CLIP.md](ACTIVE/PHASE-A-MULTI-CLIP.md)

### Phase B: Overlay Expansion (THEN)

Rich overlay system for soccer visualizations (text, ball effects, tactical markers).

**Spec**: [ACTIVE/PHASE-B-OVERLAY-EXPANSION.md](ACTIVE/PHASE-B-OVERLAY-EXPANSION.md)

### Phase C: Deployment (FINALLY)

Production deployment with Cloudflare + RunPod.

**Spec**: [ACTIVE/PHASE-C-DEPLOYMENT.md](ACTIVE/PHASE-C-DEPLOYMENT.md)

---

## Completed Features

These features are fully implemented. Docs kept for reference.

| Feature | Reference |
|---------|-----------|
| Video Loading & Playback | [COMPLETED/01-PHASE-FOUNDATION.md](COMPLETED/01-PHASE-FOUNDATION.md) |
| Animated Crop Keyframes | [COMPLETED/02-PHASE-CROP-KEYFRAMES.md](COMPLETED/02-PHASE-CROP-KEYFRAMES.md) |
| Import/Export Pipeline | [COMPLETED/03-PHASE-IMPORT-EXPORT.md](COMPLETED/03-PHASE-IMPORT-EXPORT.md) |
| Speed Controls | [COMPLETED/04-PHASE-SPEED-CONTROLS.md](COMPLETED/04-PHASE-SPEED-CONTROLS.md) |
| Trimming | [COMPLETED/05-PHASE-TRIMMING.md](COMPLETED/05-PHASE-TRIMMING.md) |

---

## Reference Documentation

| Document | Contents |
|----------|----------|
| [REFERENCE/AI-UPSCALING.md](REFERENCE/AI-UPSCALING.md) | AI super-resolution integration |
| [REFERENCE/SR_MODEL_TESTING.md](REFERENCE/SR_MODEL_TESTING.md) | Model comparison testing |

---

## Project Structure

```
src/
├── frontend/           # React 18 + Vite + Tailwind
│   └── src/
│       ├── modes/
│       │   ├── framing/   # Crop, trim, speed
│       │   └── overlay/   # Highlight effects
│       ├── components/
│       ├── hooks/
│       └── utils/
│
└── backend/            # FastAPI + Python
    └── app/
        ├── routers/       # API endpoints
        ├── ai_upscaler/   # ML models
        └── interpolation.py
```

---

## Development Workflow

### Local Development

```bash
# Frontend (Terminal 1)
cd src/frontend
npm install
npm run dev

# Backend (Terminal 2)
cd src/backend
python -m venv .venv
.venv\Scripts\activate      # Windows
source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### AI-Assisted Development

1. Read the relevant phase spec
2. Identify smallest implementable unit
3. Implement with Claude Code
4. Test against acceptance criteria
5. Move to next unit

---

## Key Decisions

- **Single video track** - Multi-clip on one track, no multi-track
- **Keyframe animation** - All effects animated via keyframes
- **Framing → Overlay workflow** - Crop/trim first, then add overlays
- **FFmpeg for processing** - Reliable, well-documented
- **AI upscaling optional** - Enhancement, not requirement

---

## External Resources

- [Cloudflare Deploy Package](../cloudflare_runpod_deploy_package/README.md) - Production infrastructure

---

## Updates

**November 2025**: Reorganized docs. Marked completed phases. Added active development specs for multi-clip, overlay expansion, and deployment.
