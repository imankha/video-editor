# Knowledge Base — Persistent Domain Expertise

One doc per code domain. An agent assigned a task reads the matching doc(s) INSTEAD of
re-exploring the codebase. This is the "code expert swarm" implemented as cached knowledge:
the expertise persists here; only what a doc doesn't cover gets explored fresh.

| Doc | Domain | Typical tasks |
|-----|--------|---------------|
| [export-pipeline.md](export-pipeline.md) | Export/publish flow, final videos, R2 storage refs, export durability | export bugs, write-path epic (T4370+) |
| [modal-gpu.md](modal-gpu.md) | Modal cloud functions, Real-ESRGAN upscaling, local FFmpeg fallback | render fidelity, GPU jobs, outro (T3950) |
| [keyframes-framing.md](keyframes-framing.md) | Crop/highlight keyframes, spline interpolation, Framing screen | keyframe unification epic (T4440+) |
| [annotate.md](annotate.md) | Annotate screen, clips/segments, virtual timeline, recap viewer | segment bugs, annotate features |
| [persistence-sync.md](persistence-sync.md) | Gesture-based persistence, R2 sync, version systems, machine pinning | durability epic (T4310+), sync bugs |
| [backend-services.md](backend-services.md) | FastAPI layout, Postgres vs SQLite access, 3-track migrations, admin | endpoint work, migrations, consolidations |

## Rules

1. **Load before exploring.** Task classification names the relevant doc(s); read them first.
2. **Update at task complete.** Stage 7 requires updating touched docs (new entry points,
   invariants, landmines discovered, stale lines pruned). Commit doc edits with the task.
3. **Docs are claims, code is truth.** On contradiction, trust the code and fix the doc in
   the same commit.
4. **Keep docs dense.** 100-200 lines each. If a doc outgrows that, split the domain.
5. **Cite file:line for load-bearing claims** so staleness is checkable.

## Maintenance

Each doc's frontmatter carries `updated:` — bump it on every edit. If a doc's date is more
than a month behind heavy activity in its domain, treat its claims with suspicion and verify
before relying on them.
