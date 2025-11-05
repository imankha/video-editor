# Video Editor

A browser-based video editing application with advanced crop keyframing and speed control features.

## Project Status

This project is in active development using AI-assisted development with Claude Code. Development follows a risk-first, phase-based approach to build features incrementally.

## Project Vision

A web-based video editor focused on:
- **Animated Crop System**: Keyframe-based cropping with smooth interpolation between different crop regions
- **Speed Controls**: Variable playback speed with dedicated timeline regions
- **Professional Timeline**: Multi-clip editing with trim, split, and arrange capabilities
- **Export Pipeline**: FFmpeg-based rendering with quality presets

## Development Approach

This project prioritizes:
1. **Risk Front-loading**: Most complex/novel features (crop keyframes) built first
2. **MVP Completeness**: Essential features (import/export) included early
3. **AI-Friendly Structure**: Clear technical requirements optimized for Claude Code
4. **Incremental Validation**: Each phase produces testable, working software

## Phase Overview

### Development Phases (Feature Building)
1. **Foundation** - Basic playback & architecture
2. **Crop Keyframes** - Animated crop system (HIGHEST RISK - Novel feature)
3. **Import/Export** - File management (MVP ESSENTIAL)
4. **Speed Controls** - Variable playback
5. **Timeline Editing** - Trim & multi-clip

### Deployment Phases (Production Readiness)
6. **Build Pipeline** - Automated builds
7. **Environment Setup** - Multi-environment deploy
8. **Cross-Platform** - Multi-device testing

## Documentation Structure

All project specifications and technical documentation are located in the [docs/](docs/) directory:

### Core Documentation
- [00-PROJECT-OVERVIEW.md](docs/00-PROJECT-OVERVIEW.md) - Complete project vision and phase breakdown
- [AI-IMPLEMENTATION-GUIDE.md](docs/AI-IMPLEMENTATION-GUIDE.md) - Guide for AI-assisted development
- [TECHNICAL-REFERENCE.md](docs/TECHNICAL-REFERENCE.md) - Technical architecture and patterns

### Phase Specifications
- [01-PHASE-FOUNDATION.md](docs/01-PHASE-FOUNDATION.md) - Video player foundation
- [02-PHASE-CROP-KEYFRAMES.md](docs/02-PHASE-CROP-KEYFRAMES.md) - Animated crop system
- [03-PHASE-IMPORT-EXPORT.md](docs/03-PHASE-IMPORT-EXPORT.md) - File I/O and rendering
- [04-PHASE-SPEED-CONTROLS.md](docs/04-PHASE-SPEED-CONTROLS.md) - Variable speed playback
- [05-PHASE-TIMELINE-EDITING.md](docs/05-PHASE-TIMELINE-EDITING.md) - Professional editing features
- [06-PHASE-BUILD-PIPELINE.md](docs/06-PHASE-BUILD-PIPELINE.md) - Build automation
- [07-PHASE-ENVIRONMENT-SETUP.md](docs/07-PHASE-ENVIRONMENT-SETUP.md) - Environment configuration
- [08-PHASE-CROSS-PLATFORM.md](docs/08-PHASE-CROSS-PLATFORM.md) - Cross-platform testing

## Getting Started

This project is being built from scratch. Phase 1 (Foundation) will establish the basic architecture and video playback system.

### Technology Stack (Planned)
- Web-based application (HTML5/Canvas)
- FFmpeg for video processing
- State management architecture (TBD in Phase 1)

## Development Philosophy

Each phase specification includes:
- Exact component requirements
- Complete data models
- Algorithm specifications
- API contracts
- Testing requirements
- Clear acceptance criteria

The specifications are written to minimize ambiguity and maximize implementation success with AI coding assistants.

## Current Phase

**Phase 1: Foundation** - Not yet started

## License

TBD
