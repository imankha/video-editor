"""T14910: the one home of the spend-readiness thresholds, windows, floors, costs and the
channel ladder. Plain module-level constants, greppable, no DB editor. Changing a threshold is
a one-line edit with a commit message saying why.

Sources: docs/plans/ua-roi-model-2026-11-03.md section 7, docs/plans/bi/topdown-vs-bottomup-
2026-11-04.md sections 8 to 10, docs/plans/tasks/T14910-design.md (revision 3).
"""
from datetime import date

# --- floors and windows -------------------------------------------------------------------
SMALL_N_FLOOR = 20            # same value as journeyTargets.js SMALL_N_FLOOR
MATURE_DAYS = 14              # a sign-up is judged only after its full 14-day window
COHORT_DAYS = 90              # mature cohort: signed up between COHORT_DAYS + MATURE_DAYS and MATURE_DAYS ago
RECENT_DAYS = 30              # the "last 30 d" second read of every cohort gate
REVENUE_DAYS = 180
REPEAT_AGE_DAYS = 180         # a payer is eligible for the repeat read once its first purchase is this old
REPEAT_GAP_DAYS = 120         # a repeat is a purchase at least this long after the first
REPRICE_DATE = date(2026, 10, 24)
MEASURED_MIN_SIGNUPS = 43     # a campaign's cost per sign-up is measured (M) from this many attributed sign-ups
CLUB_MIN_SIGNUPS = 20
KICKBACK_MIN_SIGNUPS = 100
WEEKLY_WEEKS = 12
BUILDS_SHOWN = 4
COUNTRIES_SHOWN = 3
Z = 1.96                      # 95% interval
REVENUE_CV_ASSUMED = 0.6      # (A) coefficient of variation for revenue per payer under 5 payers
SETTLE_N_CAP = 10_000_000     # settle-n search stops here: "cannot settle at this rate"

# --- costs (cents) --------------------------------------------------------------------------
GPU_PER_PLAY_CENTS = 2.5      # the ROI model's $0.025; the ladder's "$0.03" benchmark is the literal below
GPU_PER_PLAY_BENCHMARK_CENTS = 3  # coach-credits ladder row: 24 plays x $0.03
STORAGE_PER_GAME_CENTS = 5
STRIPE_PCT = 0.029
STRIPE_FIXED_CENTS = 30

# --- gate 4 shares its green threshold with the Journey map's finished->took_away target ----
# (journeyTargets.js JOURNEY_TARGETS['finished->took_away'].target; a vitest reads this file).
FINISHED_TO_TOOK_AWAY_GREEN = 80
FINISHED_TO_TOOK_AWAY_YELLOW = 60

# Gate 5 is a pair of counts: (paywall users, buyers) since the reprice.
MONEY_LADDER_GREEN = (20, 5)
MONEY_LADDER_YELLOW = (10, 2)

TIERS = {
    "A": {"label": "Can we read a test?", "unblocked_by": "shipping"},
    "B": {"label": "Is the funnel clean?", "unblocked_by": "fixing"},
    "C": {"label": "Do the economics work?", "unblocked_by": "volume"},
}

# Order is the gate number. `kind`: proportion (k of n, Wilson interval), mean (revenue per
# payer, mean +- z SE), counts (gate 5), none (grey until its source exists).
# Thresholds are in the gate's unit (pct, per100, cents, ratio). `direction` "lower" means a
# smaller value is better (gate 3).
GATES = [
    {"key": "visit_to_signup", "tier": "A", "label": "Visit to sign-up", "kind": "proportion",
     "unit": "pct", "green": 5, "yellow": 2, "direction": "higher",
     "why": "Organic visits that become sign-ups over 7 days; the landing page's own conversion."},
    {"key": "signup_to_export_14d", "tier": "B", "label": "Sign-up to export in 14 d", "kind": "proportion",
     "unit": "pct", "green": 25, "yellow": 15, "direction": "higher",
     "why": "Mature sign-ups with a true export within 14 days of signing up "
            "(a 14 d window, unlike the Journey's end-to-end, which counts ever)."},
    {"key": "upload_failure", "tier": "B", "label": "Upload failure", "kind": "proportion",
     "unit": "pct", "green": 10, "yellow": 20, "direction": "lower",
     "why": "Failed game uploads over all upload outcomes; a paid cohort that cannot get footage in is wasted."},
    {"key": "finished_to_took_away", "tier": "B", "label": "Finished to took away", "kind": "proportion",
     "unit": "pct", "green": FINISHED_TO_TOOK_AWAY_GREEN, "yellow": FINISHED_TO_TOOK_AWAY_YELLOW,
     "direction": "higher",
     "why": "Users with a finished highlight who downloaded or shared it; the same target as the Journey map's last step."},
    {"key": "money_ladder_n", "tier": "A", "label": "Money ladder n", "kind": "counts",
     "unit": "counts", "green": MONEY_LADDER_GREEN, "yellow": MONEY_LADDER_YELLOW, "direction": "higher",
     "why": "Paywall users and buyers since the reprice; the denominator the purchase funnel needs to be readable."},
    {"key": "payers_per_100", "tier": "C", "label": "Payers per 100 sign-ups", "kind": "proportion",
     "unit": "per100", "green": 5, "yellow": 2, "direction": "higher",
     "why": "Distinct purchasers per 100 sign-ups of the 90 d cohort; the first factor of break-even."},
    {"key": "revenue_per_payer", "tier": "C", "label": "Revenue per payer", "kind": "mean",
     "unit": "cents", "green": 3500, "yellow": 2000, "direction": "higher",
     "why": "Gross purchase revenue per distinct payer over 180 days; the second factor of break-even."},
    {"key": "repeat_purchase", "tier": "C", "label": "Repeat purchase", "kind": "proportion",
     "unit": "pct", "green": 25, "yellow": 15, "direction": "higher",
     "why": "Payers whose first purchase is 180 d old who bought again at least 120 d later; sport-agnostic."},
    {"key": "k_factor", "tier": "C", "label": "K-factor", "kind": "proportion",
     "unit": "ratio", "green": 0.05, "yellow": 0.02, "direction": "higher",
     "why": "Referred sign-ups over all sign-ups in the 90 d cohort; the share loop's reach."},
    {"key": "attribution_coverage", "tier": "A", "label": "Attribution coverage", "kind": "none",
     "unit": "pct", "green": 95, "yellow": 85, "direction": "higher",
     "why": "Paid sign-ups carrying a campaign id over the platform's reported conversions."},
    {"key": "kickback_payers_per_100", "tier": "C", "label": "Kickback cohort payers", "kind": "none",
     "unit": "per100", "green": 5, "yellow": 2, "direction": "higher",
     "why": "Payers per 100 among sign-ups attributed to a coach or club code; decides whether kickbacks are a channel."},
]

GATE_BY_KEY = {g["key"]: g for g in GATES}
# Gates without a Diagnose drawer besides Tier A and kind none: repeat purchase's eligible payers
# are REPEAT_AGE_DAYS old by definition, so a last-WEEKLY_WEEKS cut is always 0 of 0 (review
# follow-up 2026-11-06). Revisit when eligible payers reach SMALL_N_FLOOR.
NO_DIAGNOSIS_GATES = ("repeat_purchase",)
MEASUREMENT_TEST_GATES = ("visit_to_signup", "signup_to_export_14d", "upload_failure",
                          "finished_to_took_away", "money_ladder_n")

# Data-derived caveats (never a task status): the text a reader attaches when the data says so.
CAVEAT_EXPORT_EVENT = ("Frame export records no event (exports_started = 0 over 30 d); "
                       "this is an undercount until the export event is live.")
# T15200 shipped the spend columns (v044); gates 10/11 still have no real reader, so this
# stays accurate either way the text was written before the columns existed, now it
# just means nobody has entered spend on a campaign yet.
NO_SPEND_COLUMNS_TEXT = "no campaign has spend entered yet"

# --- channel ladder (benchmark costs, cents per sign-up; B until T15200 measures them) ------
CHANNELS = [
    {"key": "coach_credits", "label": "Coach codes, credits", "platform": "coach",
     "cost_cents": 24 * GPU_PER_PLAY_BENCHMARK_CENTS, "note": "24 plays x $0.03 GPU"},
    {"key": "coach_gift_cards", "label": "Coach codes, gift cards", "platform": "coach",
     "cost_cents": 129, "note": "$25 cards at 5 and 10 sign-ups, 25% team take-up"},
    {"key": "reddit_cheapest", "label": "Reddit, cheapest", "platform": "reddit",
     "cost_cents": 167, "note": "CPC $0.25 at 15% landing, non-US community targeting"},
    {"key": "reddit_central", "label": "Reddit, central", "platform": "reddit",
     "cost_cents": 600, "note": "2026 CPC and landing benchmarks"},
    {"key": "meta_reels", "label": "Meta Reels", "platform": "meta",
     "cost_cents": 1200, "note": "2026 CPC and landing benchmarks"},
    {"key": "club_placement", "label": "Club placement", "platform": "club",
     "cost_cents": None, "fee_cents": 30000, "note": "$300 fee over attributed sign-ups"},
]

# --- T15200: campaign registry spend -> measured ladder values ----------------------------
# A campaign's `channel` (admin.CampaignChannel) maps to the CHANNELS platform it measures.
# 'club' is deliberately absent: its ladder cost is the fixed fee over attributed sign-ups,
# already "measured" without an admin entering ad spend.
CAMPAIGN_CHANNEL_PLATFORM = {
    "coach_credits": "coach",
    "coach_gift": "coach",
    "reddit": "reddit",
    "meta": "meta",
}
# The label a measured platform's single collapsed ladder row uses (replaces every benchmark
# row of that platform -- "one measured Reddit row replaces both Reddit benchmark rows").
PLATFORM_LABELS = {
    "coach": "Coach codes",
    "reddit": "Reddit",
    "meta": "Meta Reels",
}
