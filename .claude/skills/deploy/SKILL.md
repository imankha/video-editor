# Deploy to Production

Deploy the app to production using `scripts/deploy_production.sh`.

## When to Apply
- User says "deploy", "push to production", "ship it", or similar
- User wants to deploy frontend-only or backend-only

## Procedure

1. **Pre-check**: Ensure on master, clean tree, up-to-date with origin. If not, tell the user what needs to happen first (commit, push, checkout master, etc.).

2. **Determine scope** from user intent:
   - Default (or "deploy", "push to prod"): `--all` (backend + frontend)
   - "deploy frontend" / "just the frontend": `--frontend-only`
   - "deploy backend" / "just the backend": `--backend-only`

3. **Run the script**:
   ```bash
   bash scripts/deploy_production.sh [--all | --frontend-only | --backend-only] 2>&1 | tee /tmp/deploy-output.log
   ```
   Use a 5-minute timeout (300000ms). The script handles:
   - Pre-flight checks (branch, clean tree, origin sync)
   - Backend: `fly deploy` + health check
   - Frontend: `npm run build:production` + `wrangler pages deploy` + site verify
   - Git tagging of successful deploys

4. **Promote TESTING → DONE**: After a successful deploy, scan `docs/plans/PLAN.md` for any tasks with status `TESTING` and change them to `DONE`. These tasks are now live in production. Use sed or Edit to replace all `| TESTING |` with `| DONE |` in the plan file.

5. **Report result**: Summarize what deployed, confirm the health/verify checks passed, and list which tasks were promoted from TESTING to DONE.

## If the script fails

- **Pre-flight failure**: Tell the user what to fix (wrong branch, dirty tree, not pushed).
- **Backend deploy failure**: Check `fly logs` or the Fly.io dashboard.
- **Frontend build failure**: Check the vite build output for errors.
- **Frontend deploy failure**: Check wrangler output. May need `npx wrangler pages deploy dist --project-name reel-ballers-prod --branch main` manually.
- **Health/verify failure**: The deploy went through but the app isn't responding. Check logs.

## Important

- NEVER deploy from a non-master branch
- The script tags each successful deploy (e.g., `deploy/frontend/2026-04-20`)
- If deploy output is too long, use `reduce_log` on `/tmp/deploy-output.log`
