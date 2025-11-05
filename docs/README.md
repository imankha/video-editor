# Video Editor Development Specifications

AI-optimized specifications for building a professional video editor with Claude Code.

---

## Quick Start

1. Read `00-PROJECT-OVERVIEW.md` for the big picture
2. Start with `01-PHASE-FOUNDATION.md`
3. Work through phases sequentially
4. Reference `TECHNICAL-REFERENCE.md` as needed
5. Use `AI-IMPLEMENTATION-GUIDE.md` for implementation tips

---

## Phase Structure

### Development Phases (Feature Building)
- **Phase 1**: Foundation - Basic playback & architecture
- **Phase 2**: Crop Keyframes - Animated crop system (HIGH RISK)
- **Phase 3**: Import/Export - File management (MVP ESSENTIAL)
- **Phase 4**: Speed Controls - Variable playback speed
- **Phase 5**: Timeline Editing - Trim & multi-clip support

### Deployment Phases (Production Readiness)
- **Phase 6**: Build Pipeline - Automated builds
- **Phase 7**: Environment Setup - Multi-environment deploy
- **Phase 8**: Cross-Platform - Multi-device testing

---

## File Organization

```
video-editor-specs/
├── README.md                           (this file)
├── 00-PROJECT-OVERVIEW.md              (Start here)
├── 01-PHASE-FOUNDATION.md              (Phase 1)
├── 02-PHASE-CROP-KEYFRAMES.md          (Phase 2)
├── 03-PHASE-IMPORT-EXPORT.md           (Phase 3)
├── 04-PHASE-SPEED-CONTROLS.md          (Phase 4)
├── 05-PHASE-TIMELINE-EDITING.md        (Phase 5)
├── 06-PHASE-BUILD-PIPELINE.md          (Phase 6)
├── 07-PHASE-ENVIRONMENT-SETUP.md       (Phase 7)
├── 08-PHASE-CROSS-PLATFORM.md          (Phase 8)
├── TECHNICAL-REFERENCE.md              (Reference material)
└── AI-IMPLEMENTATION-GUIDE.md          (Implementation tips)
```

---

## Key Decisions

### Risk-First Approach
Crop keyframes (Phase 2) is front-loaded because it's the most technically risky and novel feature. Testing it early validates the core value proposition.

### MVP-Essential Features
Import/Export (Phase 3) is included early because export validates the entire system. You can't truly test if everything works without being able to export.

### Simplified Scope
- No keyboard shortcuts
- No undo/redo initially
- Single video track (no multi-track)
- Local development until feature-complete

---

## Using with Obsidian

This folder is designed to work as an Obsidian vault:

1. Open Obsidian
2. Choose "Open folder as vault"
3. Select this folder
4. Navigate between documents using links
5. Use graph view to see relationships

### Useful Obsidian Features
- **Graph View**: See document relationships
- **Backlinks**: See where each concept is referenced
- **Search**: Find specific implementations
- **Outline**: Navigate long documents

---

## Using with Claude Code

### Workflow
1. Open phase spec in editor
2. Read through requirements
3. Prompt Claude Code with specific tasks
4. Implement incrementally
5. Test frequently
6. Move to next section

### Example Prompt
```
I'm implementing Phase 2: Crop Keyframes.

I need to create the CropOverlay component that shows 
a dashed border with 8 resize handles.

Requirements:
- 8 handles (corners + midpoints)
- Draggable handles
- Visual feedback during drag
- Handle snapping

Please help me implement this component.
```

---

## Development Principles

1. **Incremental**: Build one feature at a time
2. **Test Early**: Don't wait until everything is done
3. **Front-load Risk**: Tackle hard problems first
4. **AI-Friendly**: Clear, detailed specifications
5. **Pragmatic**: Ship working software, not perfect software

---

## Support

Each phase document includes:
- ✅ Clear objectives
- ✅ Technical specifications
- ✅ Data models
- ✅ Algorithms
- ✅ API contracts
- ✅ Testing requirements
- ✅ Acceptance criteria
- ✅ Implementation notes

---

## Progress Tracking

Use this checklist to track your progress:

### Phase 1: Foundation
- [ ] Video loading works
- [ ] Playback controls work
- [ ] Timeline scrubbing works
- [ ] Ready for Phase 2

### Phase 2: Crop Keyframes
- [ ] Crop overlay renders
- [ ] Handles work
- [ ] Keyframes can be created
- [ ] Interpolation works
- [ ] Ready for Phase 3

### Phase 3: Import/Export
- [ ] Import works
- [ ] Export without crop works
- [ ] Export with crop works
- [ ] Ready for Phase 4

### Phase 4: Speed Controls
- [ ] Speed regions work
- [ ] Speed affects playback
- [ ] Export includes speed
- [ ] Ready for Phase 5

### Phase 5: Timeline Editing
- [ ] Trim works
- [ ] Scissors tool works
- [ ] Multi-clip support works
- [ ] Ready for deployment

### Phase 6-8: Deployment
- [ ] Build pipeline configured
- [ ] Environments set up
- [ ] Cross-platform tested
- [ ] Ready for production

---

## Notes

- Specs are optimized for AI implementation
- Each phase builds on previous phases
- No time estimates - it's done when it's done
- Focus on working software over documentation
- Ship early, iterate based on usage

---

## License

These specifications are provided as-is for your video editor project.

---

**Ready to start?** Open `00-PROJECT-OVERVIEW.md` and begin with Phase 1!
