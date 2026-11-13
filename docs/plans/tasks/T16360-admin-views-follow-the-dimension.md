# T16360: Activation and the other admin views compare whatever the Dimension pill selects

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** The admin dashboard's Dimension pills (Campaigns, Cohorts, Builds, and Sport once T16350 lands) choose which table shows at the top. The views further down mostly ignore them. The Activation report (T7420) always groups by sign-up month. Journey, Platform Breakdown, Pack Mix and Upload Failures have their own fixed groupings.

**The problem and how we got here.** On 2026-11-13 the owner tested the new retention and activation screens and ruled that the Retention chart should compare whatever the Dimension pill selects (T7430's ruling): builds when Builds is selected, sign-up cohorts when Cohorts is selected. They asked for Activation and the other relevant views to follow the same rule. Then one pill answers "how does this build, campaign, cohort or sport compare" across the whole dashboard, instead of each view answering a different question.

**What we will do.** Make the pill set the grouping, the chart's X axis or rows, of every view where comparing groups makes sense. Activation already does this: the owner moved it into T7420 on 2026-11-13, so it lands with g-t16070-3. This task covers Journey (the step-by-step funnel per group), Platform Breakdown, Pack Mix and Upload Failures each either follow the pill or get one line in this file saying why they should not. Views that are not about groups of users (the Users list, Stripe revenue reconciliation, R2 usage) are left alone.

**Why.** The owner reads releases and campaigns by picking a pill. A view that ignores it shows a number for a different slice than the one they are looking at.

**How we will know it worked.** Switching the pill between Campaigns, Cohorts and Builds changes Activation's grouping to match, and the same for each other view this task moves; the ones it does not move are listed below with the reason.

## Order

Runs after g-t16070-3 lands (T7420's Activation report and T7430's dimension-driven Retention chart are on that branch, not yet on master). T7430's implementation of the pill-driven grouping is the pattern to reuse. Sport joins the pills in T16350; whichever of the two lands second covers Sport for these views.

## Implementer details

- Pills: `DIMENSIONS`, `dimension` and `setDimension` (`src/frontend/src/screens/AdminScreen.jsx`, `src/frontend/src/stores/adminStore.js`, T13990).
- Activation: `src/backend/app/services/analytics_activation.py` (`compute_activation_report`, monthly cohorts today) and `ActivationReport.jsx`; the dimension groupings already used by the dimension tables are in `src/backend/app/routers/admin.py` (`_segment_window_where` and the dimension-row code).
- Journey (T14020), Platform Breakdown, Pack Mix and Upload Failures sections are in `AdminScreen.jsx`; check each one's endpoint in `admin.py`.

## Acceptance Criteria

- [ ] Journey, Platform Breakdown, Pack Mix and Upload Failures each either follow the pill the same way (proven by a browser check) or are listed in this file with the reason they do not.
- [ ] The Users list, Revenue Reconciliation and R2 Usage are unchanged.
