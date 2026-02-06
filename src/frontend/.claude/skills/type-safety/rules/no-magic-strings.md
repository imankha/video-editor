# no-magic-strings

**Priority:** HIGH
**Category:** Type Safety

## Rule

Never use magic strings for values compared with `===`. Use constant objects instead.

## Detection

```javascript
// RED FLAGS
if (mode === 'crop') ...        // 🚩 Magic string
if (status === 'pending') ...   // 🚩 Magic string
const type = 'video';           // 🚩 Magic string assignment
```

## Fix

```javascript
// constants/modes.js
export const MODES = {
  CROP: 'crop',
  PAN: 'pan',
} as const;

// Usage
if (mode === MODES.CROP) ...    // ✓ Constant reference
```

## Why This Matters

| Problem | Magic String | Constant |
|---------|--------------|----------|
| Typo | Silent bug | Caught immediately |
| Rename | Find/replace, easy to miss | IDE rename, catches all |
| Autocomplete | None | Full support |
| Valid values | Unknown | Clearly defined |
