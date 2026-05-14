# T1703: Analytics Optimization -- Deep-Dives, Release Protocol, Aha Moment

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-05-13
**Epic:** [Analytics System](EPIC.md)
**Depends on:** [T1702](T1702-monetization-intelligence.md) (computed intelligence running, alerts operational, 200+ users for regression)

## Problem

After T1702, we have comprehensive tracking, dashboards, computed intelligence, and alerts. But we lack:
- A standardized protocol for measuring feature release impact
- L3 deep-dive dashboards for per-feature analysis
- Aha moment identification (which action best predicts long-term retention)
- Magic number validation (threshold action counts that predict conversion)
- Credit pricing optimization data

## Solution

Build the L3 deep-dive dashboard template, establish a feature release impact protocol, and run data-driven analyses (aha moment regression, magic number testing) once we have sufficient user data (200+ users).

See [analytics-system-plan.md](../../analytics-system-plan.md) Sections 3.4 (L3), 9 (Feature Release), and [analytics-playbook.md](../../analytics-playbook.md) Sections 5 (Aha Moment), 8 (Detecting Bad Pushes) for full spec.

## Scope

### 1. L3 Feature Deep-Dive Dashboard Template

Create a reusable OpenPanel dashboard template for per-feature analysis:

| Widget | Chart Type | Segmentation |
|--------|-----------|--------------|
| Feature adoption over time | Linear (line) | New vs. existing users |
| Before/after core metrics (ITS) | Linear with vertical line at release | All users, power users, new users |
| User flow through feature | Sankey (3+ events) | By user segment |
| Session replays | Session replay filter | Completed vs. abandoned |
| Drop-off analysis | Funnel per feature step | By device, by user tenure |
| Feature usage by engagement tier | Bar | power / active / casual |

Document how to clone and customize for each release.

### 2. OpenPanel References API Integration

Wire release marking into the deploy process:
- On each production deploy, call OpenPanel Manage API to create a Reference (vertical marker on all charts)
- Include: version number, release description, deploy timestamp
- Reference appears as a vertical line on all time-series charts, enabling visual before/after comparison

### 3. Feature Release Impact Protocol

Document and enforce the protocol for every feature release:

**Pre-release:**
1. Define success metric (what goes UP)
2. Define guardrail metrics (what must NOT go down)
3. Define revert trigger (specific threshold)
4. Mark release in OpenPanel via References API

**Post-release monitoring:**
| Timeframe | Check | Method |
|-----------|-------|--------|
| +1 hour | Error rate spike? | Hourly cron alert |
| +4 hours | P95 latency increase? Export failures? | Hourly cron alert |
| +24 hours | Session duration drop? Core action drop? | L3 dashboard |
| +24 hours | Watch 5-10 session replays | OpenPanel session replay |
| +48 hours | D1 retention for post-release cohort? | L2-C retention grid |
| +7 days | Full guardrail review. Credit purchase rate stable? | L3 + weekly digest |

**Decision framework:**
- Safety/data integrity issue -> revert immediately
- Error/crash rate regressed -> revert within 1 hour
- Engagement metrics regressed -> investigate 24-48h
- Success metric positive after 7d -> keep
- Success metric flat after 7d -> consider reverting
- Success metric negative -> revert or redesign

### 4. K-Factor Computation

Add to nightly analytics engine:
- **Reel K-factor**: (reel shares per user per week) x (share-link-to-signup conversion rate)
- **Team K-factor**: (team shares per annotator per week) x (teammate-tag-to-signup conversion rate)
- Push both to L2-F dashboard as time series

### 5. ARPU / Revenue Computation

Add to weekly digest and L2-D:
- ARPU = total_credit_revenue / all_active_users (weekly)
- ARPPU = total_credit_revenue / paying_users (weekly)
- Revenue per game = total_credit_revenue / total_games_uploaded

### 6. Aha Moment Regression (requires 200+ users)

Compare D30 retained vs. churned users on candidate actions:

**Candidates** (ranked by expected signal strength):
1. **Exported first highlight reel** -- parent sees polished video of their kid
2. **Shared first clip to a teammate's parent** -- social commitment + team viral loop
3. **Created clips from 2nd game** -- recurring weekly workflow, not novelty
4. **Bought first credit pack** -- financial commitment validates value

**Method:**
1. Pull from OpenPanel Export API: all users with D30+ tenure
2. Split into retained (active in last 14d) vs. churned
3. For each candidate, measure: % of retained who did it in first 7d vs. % of churned who did it
4. Candidate with largest gap is the likely aha moment
5. Validate causally: push one cohort toward the action faster (better onboarding, prompts). If retention improves, it's causal.

### 7. Magic Number Hypothesis Testing (requires 200+ users)

Test threshold action counts that predict conversion (free-to-paid):

| Hypothesis | Measurement |
|------------|-------------|
| Export 2+ reels in first 14 days | Split by threshold, compare repurchase rate |
| Share 1+ clips in first 7 days | Split by threshold, compare D30 retention |
| Upload games from 2+ different dates | Split by threshold, compare repurchase rate |
| Tag 1+ teammates | Split by threshold, compare D60 retention |

**Need:** 200-500 users minimum. Compare "did it in first 7d" vs. "didn't." Look for 2x+ gap in D30/D60/D90 retention.

### 8. Credit Pricing Experiments

Use OpenPanel property-based breakdowns to analyze:
- Do 20-pack buyers have higher credit utilization than 1-pack buyers?
- Do users who extend credits (pay 1 credit for 7-day extension) retain better?
- Is there a credit price sensitivity signal in purchase abandonment rate?
- Segment by `early_value_score`: do high-EVS users buy bigger packs?

## Files Affected

| File | Change |
|------|--------|
| `src/backend/app/analytics/engine.py` | Add K-factor computation, ARPU/revenue computation |
| Deploy script or CI | Add OpenPanel References API call on deploy |
| `src/backend/app/analytics/` (new scripts) | Aha moment regression, magic number analysis |
| Documentation | Feature release protocol doc |

## Acceptance Criteria

- [ ] L3 deep-dive dashboard template documented and usable
- [ ] Feature releases automatically marked in OpenPanel via References API
- [ ] Feature release protocol documented with pre/post checklists
- [ ] K-factor (reel + team) computed and visible in L2-F
- [ ] ARPU, ARPPU, revenue per game computed and in weekly digest
- [ ] Aha moment regression run with results documented (when 200+ users available)
- [ ] Magic number hypotheses tested with results documented (when 200+ users available)
- [ ] Credit pricing analysis completed with actionable findings
