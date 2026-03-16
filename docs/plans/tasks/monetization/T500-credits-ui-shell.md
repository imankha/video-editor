# T500: Credits UI Shell (Frontend Shell)

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

Users need to see their credit balance and understand when they can't perform GPU operations. We want to test the credits UX with real users before building the backend.

## Solution

Frontend-only credit system UI: balance display in header, "insufficient credits" modal when trying a GPU operation with 0 credits, and a placeholder "Buy Credits" button. Uses mock data from Zustand store.

## Context

### Relevant Files
- `src/frontend/src/stores/creditStore.js` - NEW: Zustand store (balance, deduct, grant)
- `src/frontend/src/components/CreditBalance.jsx` - NEW: header balance display
- `src/frontend/src/components/InsufficientCreditsModal.jsx` - NEW: purchase prompt modal
- Header/nav component - Add CreditBalance

### Related Tasks
- Related: T400 (auth gate — credits UI appears after authentication)
- Blocks: T510 (GPU cost gate uses these components)

### Technical Notes

**Credit store (Zustand, mock):**
```javascript
{
  balance: 3,              // starts with mock free credits
  deduct: (amount) => {}, // subtract from balance
  grant: (amount) => {},  // add to balance
  canAfford: (cost) => boolean,
}
```

**Balance display:**
- Small pill/badge in header: "3 credits" or coin icon + number
- Only visible when authenticated
- Animates on change (deduct/grant)

**Insufficient credits modal:**
```
┌─────────────────────────────────────┐
│  You need more credits              │
│                                     │
│  This operation costs 1 credit.     │
│  Your balance: 0 credits.           │
│                                     │
│  [Buy Credits]  (placeholder)       │
│  [Cancel]                           │
└─────────────────────────────────────┘
```

## Implementation

### Steps
1. [ ] Create creditStore.js with mock balance + operations
2. [ ] Create CreditBalance.jsx header component
3. [ ] Create InsufficientCreditsModal.jsx
4. [ ] Add CreditBalance to header (only when authenticated)
5. [ ] Style per UI style guide

## Acceptance Criteria

- [ ] Credit balance visible in header when authenticated
- [ ] Balance hidden when not authenticated
- [ ] Deducting credits updates display
- [ ] 0 credits + GPU action → insufficient credits modal
- [ ] "Buy Credits" button exists (non-functional placeholder)
- [ ] Responsive on mobile
