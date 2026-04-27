# T445: Vehicle Window Cards — Design & Print

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-04-06
**Updated:** 2026-04-06

## Problem

Cards placed on vehicle windows at games are the primary offline-to-online funnel for the target audience (soccer parents). Every car in the lot belongs to a parent who is exactly the target demographic — highly engaged in their child's sports development. They need a card they can scan that takes them straight to the app.

## Solution

Design a card for placing on vehicle windows at youth soccer games. QR code linking to reelballers.com. Print via an online service. The card should communicate what the product does in 2 seconds and have a scannable QR code that works on any phone camera. Size/format may need adjustment for windshield visibility vs. standard business card.

## Design

### Card specs

| Property | Value |
|----------|-------|
| Size | 3.5" x 2" (standard US business card) |
| Orientation | Horizontal |
| Corners | Rounded (1/8" radius) — modern feel |
| Finish | Matte or soft-touch matte — premium feel, no glare on QR code |
| Paper stock | 16pt or 18pt — thick enough to feel substantial |
| Sides | 2-sided (front + back) |
| Color mode | CMYK |
| Resolution | 300 DPI minimum, 3.75" x 2.25" with bleed (0.125" per side) |
| Safe zone | Keep text/logo 0.125" from trim edge |

### Front (primary side)

```
┌─────────────────────────────────────────────┐
│                                             │
│    [Logo]  Reel Ballers                      │
│                                             │
│    Share Your Player's Brilliance           │
│                                             │
│    AI-powered highlight reels               │
│    from your game footage                   │
│                                             │
│              ┌──────────┐                   │
│              │ QR CODE  │   reelballers.com  │
│              │          │                   │
│              └──────────┘                   │
│                                             │
└─────────────────────────────────────────────┘
```

**Elements:**
- **Logo** — Film reel + play button icon (from favicon.svg), rendered at high res
- **App name** — "Reel Ballers" in bold, white text
- **Tagline** — "Share Your Player's Brilliance" (matches landing page hero)
- **Subtitle** — "AI-powered highlight reels from your game footage" (one line, explains what it does)
- **QR code** — Links to `https://reelballers.com` (landing page, not directly to app — landing page does the selling)
- **URL text** — `reelballers.com` printed below/beside QR for people who prefer to type
- **Background** — Dark gradient matching app/landing page (`slate-900` to `purple-900`)

### Back

```
┌─────────────────────────────────────────────┐
│                                             │
│    ✓ Upload game footage                    │
│    ✓ AI follows your player                 │
│    ✓ Professional quality highlights        │
│    ✓ Social-ready formats                   │
│                                             │
│           Try it free                       │
│                                             │
└─────────────────────────────────────────────┘
```

**Elements:**
- **Feature bullets** — 4 short value props (checkmarks, white text)
- **"Try it free"** — reinforces there's no upfront cost
- **Background** — Same dark gradient, or solid dark with subtle purple accent

### Brand colors (CMYK conversion)

| Color | Hex | Use | CMYK (approximate) |
|-------|-----|-----|-----|
| Slate 900 | #0f172a | Background | C:85 M:72 Y:45 K:55 |
| Purple 500 | #a855f7 | Accent, gradient | C:45 M:70 Y:0 K:0 |
| Indigo 500 | #6366f1 | Gradient end | C:60 M:60 Y:0 K:0 |
| White | #ffffff | Text, logo | C:0 M:0 Y:0 K:0 |
| Gray 400 | #9ca3af | Subtitle text | C:35 M:25 Y:22 K:0 |

**Important:** Get a physical proof before bulk printing — dark backgrounds with gradients can shift significantly between screen and print. The purple gradient is the brand identity and must look right.

### QR code specs

- **Content:** `https://reelballers.com`
- **Size:** Minimum 0.8" x 0.8" on the card (needs to scan reliably from phone cameras)
- **Error correction:** Level H (30% — tolerates print imperfections)
- **Style:** White QR on dark background (inverted). Standard square modules, no fancy shapes that reduce scannability.
- **Quiet zone:** Minimum 4-module white border around QR code
- **Test:** Print a test QR at final size and verify it scans on iPhone and Android from 6" away

### Design tool

Use **Canva** (free tier is sufficient) or **Figma**:
- Both export print-ready PDF with bleed marks
- Canva has business card templates at correct dimensions
- Export as PDF (Print) at 300 DPI with crop marks and bleed

## Print service

### Recommended: Vistaprint

| Factor | Details |
|--------|---------|
| Service | [vistaprint.com](https://vistaprint.com) |
| Product | Standard business cards, rounded corners |
| Stock | 16pt or 18pt matte / soft-touch |
| Quantity | Start with 250 (cheapest tier, enough for 5-10 games) |
| Cost | ~$20-30 for 250 cards |
| Turnaround | 5-7 business days standard, 2-3 days rush |
| Upload format | PDF with bleed (3.75" x 2.25") or use their online editor |
| Proofing | Digital proof included; order physical proof first if budget allows |

**Alternatives:**
- **Moo.com** — higher quality paper/finish, ~$50 for 250, better for premium feel
- **GotPrint.com** — cheapest option, ~$15 for 250, good quality for the price
- **Local print shop** — fastest turnaround, can see proof same-day, but typically more expensive

### Recommendation

Order 250 from Vistaprint (soft-touch matte, rounded corners). If the first batch looks good, reorder in bulk (500-1000 drops the per-card cost significantly).

## Implementation

### Steps
1. [ ] Generate high-res logo PNG from favicon.svg (at least 1000x1000px for print)
2. [ ] Generate QR code for `https://reelballers.com` (SVG or high-res PNG, error correction level H)
3. [ ] Design front of card in Canva/Figma (3.75" x 2.25" with bleed, 300 DPI)
4. [ ] Design back of card
5. [ ] Export print-ready PDF with bleed marks
6. [ ] Print test QR code at card size, verify scanning on iPhone + Android
7. [ ] Review CMYK color accuracy (purple gradient especially)
8. [ ] Order 250 cards from Vistaprint (soft-touch matte, rounded corners)
9. [ ] Verify physical proof when it arrives
10. [ ] Hand out at games

## Acceptance Criteria

- [ ] Card clearly communicates what the product does in under 2 seconds
- [ ] QR code scans reliably on both iPhone and Android phone cameras
- [ ] QR code links to reelballers.com
- [ ] Colors match brand (dark background, purple gradient accent)
- [ ] Text is legible (minimum 8pt font, white on dark)
- [ ] Print quality is professional (no pixelation, colors accurate)
- [ ] Cards are in hand and ready to distribute at games
