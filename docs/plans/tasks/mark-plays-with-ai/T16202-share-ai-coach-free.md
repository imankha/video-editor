# T16202: Share AI Coach for free

## In plain words

AI Coach is the paid option that has a video model watch a game (the full match video) and mark the plays (moments worth keeping) for the parent's team. Today's plan lets a parent share a game as the app already does, but the family that receives it gets plain plays: they cannot see which player the AI meant, cannot go through the plays to find their own child, and would have to pay 135 credits to get that. We will make one payment cover the whole team. When a parent who has AI Coach on a game shares that game, the receiving family gets AI Coach on it too, at no cost, and can share it on. The app says so wherever the feature is sold and wherever a game is shared. The analysis is computed once whoever looks at it, so a free receiver costs us nothing, and each one is a family that has now used the product on a game they care about. Done when a second account that receives a shared game can find its own athlete's plays without paying, and the owner can see how many receivers each paid analysis produced and how many of them later bought one for a game of their own.

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Tier:** L (sharing path, shared-database record, new screens; Migration agent)
**Created:** 2026-11-14
**Updated:** 2026-11-14

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 9 of 10. Screens and strings: section 11 of [UX-FEEDBACK.md](UX-FEEDBACK.md). The owner approved the receiving family's card and ruled on the open choices on 2026-11-14 (its section 9, rulings 18 and 19).

## Problem

The app grows when one family brings in another. The referral programme is blocked, and paid advertising loses money on every sign-up. A youth team has around fifteen families who all want the same game, and one of them paying for AI Coach is the natural moment for the other fourteen to hear about the app. If the receiving family gets only plain plays, the share is a favour. If it gets the full thing, with its own child's plays one tap away, the share is the product.

## Solution

### 1. The rule

- A parent has AI Coach on a game when they bought it or when the game was shared to them by someone who has it.
- Sharing a game that has AI Coach always passes AI Coach along. There is no switch and no limit on how many families receive it or how far it travels.
- A parent who uploads the same video on their own, with no share, still pays the normal price and gets the stored result at once. The free route is the share, so there is a reason to ask a teammate's parent for it.
- Nothing is charged to the receiver, and nothing more to the sharer.

### 2. What the receiving family gets

- The game arrives as it does today, with the Team lane plays the sharer has (the Team lane holds plays that are not specifically one parent's own child).
- The AI plays among them arrive as the sharer left them (owner, 2026-11-14): a play the sharer edited arrives edited, and one the sharer deleted does not arrive. The app's share already works this way for every team play, and the sharer's clean-up is worth passing on. A play the sharer moved to their own athlete is no longer a team play, so it does not travel; that is how sharing works today and it is accepted.
- Every AI play that travels keeps what the AI wrote about each player, so the receiver gets the player chips, the Tag players pass (T16200), the "Wrong team" button and "Switch team" (T16190), all free.
- If the sharer tagged the receiver's child as a teammate on some plays, those plays open first in the receiver's Tag players pass with a one-tap suggestion: "Sam says this is Ava". It is a suggestion, never filled in silently.
- The game shows who it came from: "AI Coach, shared by Sam. Free for you."

### 3. Where the sharer is told

The promise "Pay once. Share it with your whole team for free." appears:

- in the offer (T16170, T16180), as its own line with a short explanation;
- on the summary card after the plays are added, as a button, "Share with your team, free";
- on the last screen of the Tag players pass;
- in the existing step that tags a teammate by name and email, as one added line: "Ava's family gets this game with AI Coach, free.";
- in the "AI Coach finished" email.

All of these open the app's existing game share. This task adds no new way to share; it changes what a share carries and what the screens say about it.

### 4. Where the receiver is told

- The share email and the page it opens say that the game comes with AI Coach, who paid for it, and that it is free for them. If the sharer tagged their child, it says in how many plays.
- On the game, a card in the same slot the other AI Coach cards use leads to "Find Ava's plays" (the Tag players pass).
- After the receiver has been through the pass once, one quiet line offers AI Coach for their own games with the real rate. The next time they upload a game, the offer names what they already used: "You used AI Coach on a game Sam shared."
- A receiver without an account creates one to open the game, as with any share today. That sign-up is the growth this task exists for.

### 5. A game shared before AI Coach was bought

A parent often shares a game first and decides on AI Coach later. When that parent's AI plays are added to the game, every family the game was already shared with gets them, and AI Coach with them, without anyone sharing again (owner, 2026-11-14). Each of those families gets one email, "Sam added AI Coach to the game", with the same button as the share email. The promise is "pay once for the whole team", and a family that got the game early should not see a price for something the team has paid for.

### 6. What we measure

- For each paid analysis: how many families received it, and how many of those were new accounts.
- For receivers: how many opened the game, how many went through the Tag players pass, how many made a highlight (a finished short clip) from an AI play, and how many bought AI Coach on a game of their own within 30 days.
- These appear in the Journey and in the AI Coach read-out for the owner (T16160), next to credits earned and model cost.

## Why this and not something else

Giving receivers plain plays and selling them the rest was the earlier plan. It keeps a second sale on the same game, but that sale is small (135 credits) next to a new family that has used the product. The owner chose reach (2026-11-14).

Making a game free for every account that holds the same video, shared or not, was considered. It is simpler, but then nobody needs to ask the payer for anything, no share happens, and the payer feels they paid for strangers.

Limiting how many families one payment covers was considered and dropped: a receiver costs us nothing, and a limit would be a rule to explain on a screen that is trying to say "free".

The cost of this choice is stated plainly: the price table in the epic no longer gets extra margin from a second buyer of the same game. Each game is still paid for once and still earns more than it costs.

## How we will know it worked

On staging, account A buys AI Coach on a game and shares it with account B. B opens the game, pays nothing, goes through the Tag players pass and ends with plays under their own athlete. After launch, the read-out shows receivers per paid analysis and how many receivers went on to buy.

## For the implementer

### Proposed record (Postgres; Architect confirms)

`game_analysis_purchases` (T16160) gains `source` (`purchase`, `share`) and `granted_by_purchase_id` (nullable, self-reference). A share grant is a row with `credits = 0`, `status = charged`, `source = share`. The existing unique rule (one row per user, profile and game) holds, so "has AI Coach on this game" stays one lookup for buyers and receivers alike. A receiver who had already bought keeps their purchase row.

### Relevant Files (REQUIRED)
- `src/backend/app/routers/analysis.py`, `services/game_analysis.py` (grant on share; quote reports "already yours, shared by {name}")
- The game share and tagged-teammate share paths and their materialization of the receiver's copy (T9810: `SharePlaybackDialog`, `ShareWithTeammatesModal`, and the server code that copies a game into the receiver's data); find the single seam where a game is materialized for a receiver and write the grant there
- `src/backend/app/services/analysis_import.py` (T16190): the receiver's import runs through the same function with the sharer's team key
- `src/backend/app/services/pg.py` and a postgres migration; `app/migrations/profile_db/` only if the receiver's game needs a new column for the sharer's name
- `src/backend/app/services/email.py` (share email gains the AI Coach lines)
- `src/frontend/src/components/analysis/` (summary card button, shared-by card), the Tag players pass (T16200) for the "Sam says this is Ava" suggestions and the done screen
- `src/frontend/src/components/instructions/displayNames.js` (strings from UX-FEEDBACK.md section 11)
- `src/backend/app/analytics.py`, the admin read-out from T16160
- `.claude/knowledge/annotate.md`, `backend-services.md`

### Technical Notes
- The share's copy of a team play must carry `ai_source` (materialization copies named columns only today, so add it), including the sharer's flips. Reset `touched` and each mention's `assigned` on the receiver's copy, so the receiver's Tag players pass starts fresh, and do not copy the sharer's position memory. The receiver gets no separate import; "Switch team" on the receiver's copy is the one place the receiver's game reads the stored analysis directly.
- The grant is written when the receiver's copy is materialized, which is a backend lifecycle step with its own contract, not a reactive write from the editor. Delivering a play twice must not duplicate it: use the play's natural key.
- The sharer's team key is carried in the share so the receiver starts on the same team; "Switch team" covers a parent of the other team who was sent the game.
- "Sam says this is Ava": the sharer's teammate tags on Team plays already travel with the share. Match them to the receiver's athlete by the share's own target (the tagged teammate the share was sent for), never by comparing names.
- A share of a game whose analysis is still running carries the grant; the receiver sees the same progress states.
- A game shared before the sharer bought AI Coach: when the sharer's import (T16190) adds AI plays to the Team lane, deliver them to every existing receiver of that game and write each a grant. First find out whether the existing share already delivers team plays added after the share; if it does, reuse that path and add only the grant and the email. One email per receiver per game, respecting the email opt-out; event `ai_share_granted` with context `earlier_share`.
- Events: `ai_share_granted` (context: new account or existing), `ai_share_opened`, `ai_share_tag_pass_opened`, `ai_receiver_purchased`.
- Behind the epic's feature flag.

### Related Tasks
- Depends on: T16160 (purchase record), T16190 (import), T16200 (Tag players pass), T16170 and T16180 (the offer carries the promise). Blocks: nothing.

## Acceptance Criteria

- [ ] Account A buys AI Coach on a game and shares it with account B; B's copy has the AI plays for A's team with player chips, and B's balance is unchanged.
- [ ] B can open the Tag players pass, flip a play with "Wrong team" and switch team, all without a charge.
- [ ] B's Team lane holds A's team AI plays as A left them: a play A edited arrives edited, and a play A deleted does not arrive.
- [ ] Sharing the same game with B a second time adds no play twice.
- [ ] A shares a game with B, then buys AI Coach and picks a team: B's copy gains the AI plays and AI Coach without A sharing again, and B gets exactly one email saying so.
- [ ] B shares the game with account C, and C gets AI Coach free as well.
- [ ] Account D uploads the same video with no share and is quoted the full price.
- [ ] When A tagged B's child on plays before sharing, B's pass opens on those plays with the suggestion naming A, and nothing is assigned until B taps.
- [ ] B's game shows that AI Coach was shared by A and is free; A's summary card, tagging done screen and teammate step each carry the free-share line.
- [ ] The offer shown to B on their next upload names the shared game.
- [ ] The owner's read-out shows, per paid analysis, the number of receivers and how many were new accounts; `ai_share_granted`, `ai_share_opened` and `ai_receiver_purchased` appear in the admin Journey inspector.
- [ ] Works at 390 px and on desktop; with the flag off, sharing behaves as it does today.
