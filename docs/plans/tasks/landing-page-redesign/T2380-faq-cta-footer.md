# T2380: FAQ, Final CTA & Footer

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

The current page has no FAQ (objection handling), no final CTA for convinced users at the bottom, and the footer lacks structured navigation.

## Solution

### Section 8 -- FAQ

**Header:**
```
## Common questions
```

**Layout:** Accordion or expand-on-click. Six questions, six short answers.

**Questions (in this order -- order is calibrated to objection sequence):**

1. **Does it work with Trace footage?**
   Yes. Anything you can download from Veo, Trace, Pixellot, or your phone works.

2. **How long does it take?**
   About five minutes from upload to download for a 30-second reel. Your first export is on us.

3. **Does my kid have to be in the frame the whole time?**
   No. Pick the moments she's in. We track her through them.

4. **What if the export fails?**
   Credits refund automatically. We don't charge for what didn't work.

5. **Do I have to install anything?**
   No. It runs in your browser. Phone or laptop, doesn't matter.

6. **Can I make a recruiting reel with this?**
   Yes. Most college coaches still want horizontal -- we export both.

**Order matters:** Lead with Trace because headline mentions Veo only.

### Section 9 -- Final CTA

**Layout:** Single centered block, generous vertical padding, full-width band with slightly different background tone (touch lighter).

**Copy:**
```
## Your kid had a moment last weekend.
### Make the reel.

[ Make the reel ]
```

No subhead. No bullets. No alternatives. One job: give the convinced user a final, simple action.

### Footer

Standard footer, minimal:
- Reel Ballers logo
- Three columns: Product (How it works, Pricing, Sign in), Company (About, Blog, Contact), Legal (Privacy, Terms)
- Bottom line: "(c) 2026 Reel Ballers. Made for soccer parents who film every match."

That last line is voice-as-marketing: identifies audience and makers in one breath.

## Context

### Relevant Files
- `src/landing/src/App.tsx` -- current footer to replace

### Related Tasks
- Depends on: T2300 (Visual Foundation)

## Implementation

1. [ ] Create FAQ component with accordion/expand behavior
2. [ ] Add 6 questions with answers in specified order
3. [ ] Create FinalCTA component with centered copy + button
4. [ ] Create Footer component with 3-column layout + bottom line
5. [ ] Wire "Make the reel" button to upload flow
6. [ ] Responsive: footer columns stack on mobile

## Acceptance Criteria

- [ ] FAQ has 6 questions in correct order with expand/collapse
- [ ] Trace question appears first
- [ ] Final CTA section has "Make the reel" button only (no extra content)
- [ ] Footer has 3-column navigation + copyright line
- [ ] Copyright line reads "Made for soccer parents who film every match."
