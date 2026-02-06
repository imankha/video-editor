---
name: type-safety
description: "Prefer Enums over magic strings in Python. Use str Enum classes for type-safe string literals with IDE support."
license: MIT
author: video-editor
version: 1.0.0
---

# Type Safety (Python)

Avoid magic strings. Use `Enum` classes for type safety, validation, and autocomplete.

## When to Apply

- Defining modes (fast, quality)
- Defining status values (pending, complete, error)
- Defining effect types (brightness_boost, dark_overlay)
- Any string compared with `==`

## The Pattern

```
BEST:    Enum classes (str, Enum)
BAD:     Magic strings
```

---

## Examples

### Bad: Magic Strings
```python
# BAD: Typos cause silent bugs, no autocomplete
if effect_type == "brightnes_boost":  # Typo! Silent bug
    apply_brightness()

if export_mode == "qualty":  # Typo! Never matches
    use_high_quality()
```

### Good: Enums
```python
from enum import Enum

class EffectType(str, Enum):
    ORIGINAL = "original"
    BRIGHTNESS_BOOST = "brightness_boost"
    DARK_OVERLAY = "dark_overlay"

# Usage - typos caught, autocomplete works
if effect_type == EffectType.BRIGHTNESS_BOOST:
    apply_brightness()
```

### Good: Export Mode Enum
```python
class ExportMode(str, Enum):
    FAST = "fast"
    QUALITY = "quality"

# Usage
if export_mode == ExportMode.QUALITY:
    use_high_quality_settings()
```

### Good: Status Enum
```python
class ExportStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETE = "complete"
    ERROR = "error"

# Usage
job.status = ExportStatus.PROCESSING
if job.status == ExportStatus.COMPLETE:
    notify_user()
```

---

## Why `str, Enum`?

Inheriting from both `str` and `Enum` makes the enum JSON-serializable:

```python
class EffectType(str, Enum):
    BRIGHTNESS_BOOST = "brightness_boost"

# Works with JSON
import json
json.dumps({"effect": EffectType.BRIGHTNESS_BOOST})
# Output: {"effect": "brightness_boost"}

# Works with string comparison (for external data)
external_value = "brightness_boost"
if external_value == EffectType.BRIGHTNESS_BOOST:
    print("Match!")  # Works!
```

---

## File Organization

```
src/backend/app/
└── enums/
    ├── __init__.py       # Re-exports all enums
    ├── effect_type.py
    ├── export_mode.py
    └── export_status.py
```

Or define in the module where they're most used:

```python
# app/routers/export.py
class ExportStatus(str, Enum):
    PENDING = "pending"
    ...
```

---

## Pydantic Integration

Enums work seamlessly with Pydantic models:

```python
from pydantic import BaseModel

class ExportRequest(BaseModel):
    mode: ExportMode
    effect_type: EffectType

# Validation happens automatically
request = ExportRequest(mode="fast", effect_type="brightness_boost")
# request.mode == ExportMode.FAST
# request.effect_type == EffectType.BRIGHTNESS_BOOST
```

---

## Migration Checklist

When refactoring magic strings:

1. [ ] Create enum class (inherit from `str, Enum`)
2. [ ] Define all values as class attributes
3. [ ] Find all usages: `grep -rn "== \"value\"" app/`
4. [ ] Replace with enum reference
5. [ ] Import enum where needed
6. [ ] Update Pydantic models to use enum type
7. [ ] Verify no string literals remain

---

## Complete Rules

See individual rule files in `rules/` directory.
