# T2310: Sticky Nav & CTA System

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

The current nav has no CTA button. The user has to scroll past six feature tiles before they can take action. On mobile, there's no persistent way to convert. The mobile sticky bottom CTA bar is "probably the single highest-leverage element you don't currently have" -- 5-10% conversion lift on most consumer products.

## Solution

### Desktop Nav (Sticky)

```
[Reel Ballers logo]              How it works   Pricing   Sign in   [ Try it free ]
```

- Sticky on scroll
- Condenses height ~20% after first scroll
- Background: transparent -> slightly darker shade with 1px bottom border
- "Try it free" is the primary accent-color button (routes to sign-up / editor)
- "Sign in" is a text link (routes to login)

### Mobile Nav

- Logo left, hamburger right
- Hamburger expands to a sheet with nav items + full-width "Try it free" button at top

### Mobile Sticky Bottom Bar

- Full-width primary button: "Try it free"
- Persists throughout the entire page scroll
- Routes to upload flow
- This is the single biggest mobile conversion lever

### CTA Voice Rules

- Hero: names what happens ("Make my first reel -- free")
- Mid-page: softer, exploratory ("Try it on your own clip")
- Final: directive ("Make the reel")
- Never use: "Get started," "Learn more," "Click here," "Sign up free"

## Context

### Relevant Files
- `src/landing/src/App.tsx` -- current nav implementation
- `src/landing/src/components/Logo.tsx` -- logo component

### Related Tasks
- Depends on: T2300 (Visual Foundation -- accent color, font)
- Related: All other tasks use the CTA system defined here

## Implementation

1. [ ] Create NavBar component with sticky behavior
2. [ ] Add scroll listener for height condensing + background change
3. [ ] Add "How it works" and "Pricing" anchor links
4. [ ] Add "Sign in" text link (routes to app login)
5. [ ] Add "Try it free" primary button (routes to app sign-up)
6. [ ] Create mobile hamburger menu with sheet overlay
7. [ ] Create MobileStickyBar component (full-width "Try it free" button, fixed bottom)
8. [ ] Ensure mobile bar doesn't overlap footer or other fixed elements

## Acceptance Criteria

- [ ] Nav sticks on scroll with condensing animation
- [ ] "Try it free" button visible at all times on desktop (nav)
- [ ] "Try it free" button visible at all times on mobile (sticky bottom bar)
- [ ] Hamburger menu works on mobile with full nav items
- [ ] Anchor links scroll to correct sections
- [ ] CTA buttons use accent color from T2300
