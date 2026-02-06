# no-magic-strings

**Priority:** HIGH
**Category:** Type Safety

## Rule

Never use magic strings for values compared with `==`. Use Enum classes instead.

## Detection

```python
# RED FLAGS
if effect_type == "brightness_boost":  # 🚩 Magic string
if export_mode == "quality":           # 🚩 Magic string
status = "pending"                     # 🚩 Magic string assignment
```

## Fix

```python
from enum import Enum

class EffectType(str, Enum):
    BRIGHTNESS_BOOST = "brightness_boost"
    DARK_OVERLAY = "dark_overlay"
    ORIGINAL = "original"

# Usage
if effect_type == EffectType.BRIGHTNESS_BOOST:  # ✓ Enum reference
    ...
```

## Why `str, Enum`?

- JSON serializable (no custom encoder needed)
- Comparable with raw strings (for external data)
- Type hints work correctly
- Pydantic validates automatically

## Why This Matters

| Problem | Magic String | Enum |
|---------|--------------|------|
| Typo | Silent bug | Caught immediately |
| Rename | Find/replace, easy to miss | IDE rename, catches all |
| Autocomplete | None | Full support |
| Validation | Manual | Automatic with Pydantic |
| Documentation | Comments (get stale) | Enum itself is docs |
