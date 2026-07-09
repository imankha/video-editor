---
name: deploy-landing
description: "Deploy the marketing landing site (reelballers.com) to production"
---

# Deploy the Landing Site

Ships the marketing landing page at **https://reelballers.com** (the app `src/landing`).
This is SEPARATE from the main app deploy (`scripts/deploy_production.sh` / the `deploy`
skill). The landing is a standalone Vite app deployed to a Cloudflare Worker.

## When to Apply
- User says "deploy the landing", "push the landing site to prod", "ship the landing page".
- Any change under `src/landing/**` needs to go live.

## How it deploys (the mechanism)
There is NO manual `wrangler` step you run. Deployment is triggered by pushing to `master`:

```
push to master (paths: src/landing/**)  ->  .github/workflows/deploy-landing.yml
    -> npm ci (src/landing)  ->  npm run build  ->  npx wrangler deploy
```

So "deploy the landing" == "land the src/landing change on master". Worker name `video-editor`,
serves `src/landing/dist`. Custom domain: `reelballers.com` (NOT `www.` — that host has no bundle).

## Procedure

1. **Pre-flight: build under CI-IDENTICAL conditions — this is the #1 gotcha.**
   A plain local `npm run build` in `src/landing` is NOT a valid check. The landing shares the
   editor's player leaves via the `@editor` Vite alias (`../frontend/src/...`), and those files
   import bare deps (`react`, `lucide-react`). Node resolves those relative to the importer, i.e.
   from `src/frontend/node_modules`, which exists locally but **CI never installs** (the workflow
   only runs `npm ci` in `src/landing`). A local build passes; CI fails with
   `Rollup failed to resolve import "lucide-react"`.

   Reproduce CI in a clean worktree before pushing:
   ```bash
   WT="/c/tmp/landing-verify-$$"
   git worktree add "$WT" origin/master           # or your branch
   cd "$WT/src/landing"
   ls ../frontend/node_modules 2>/dev/null && echo "NOT CI-like (frontend deps present)"
   npm ci && npm run build                        # must succeed with frontend node_modules ABSENT
   ```
   If it fails on a bare import from an `@editor` file, add it to `resolve.dedupe` in
   `src/landing/vite.config.ts` (already covers `react`, `react-dom`, `lucide-react`). Only ever
   import STORE-FREE modules through `@editor` — a Zustand/backend import there drags the editor's
   graph into this bundle. See memory `project_landing_shares_editor_player`.

2. **Land the change on `master`.** In this SHARED checkout you usually CANNOT `git checkout master`
   (other sessions leave uncommitted WIP like `docs/plans/PLAN.md`; never `git stash` / `git add -A`).
   Land the merge in an isolated worktree instead:
   ```bash
   git push -u origin <your-branch>
   WT="/c/tmp/landing-land-$$"
   git worktree add "$WT" origin/master
   cd "$WT"
   git merge --no-ff origin/<your-branch> -m "Merge branch '<your-branch>'\n\n<summary>\n\nCo-Authored-By: ..."
   git push origin HEAD:master
   cd - && git worktree remove "$WT" --force; git worktree prune
   git fetch origin master:master                  # sync the shared tree's local master ref
   ```
   (If the shared tree IS cleanly on master and up to date, a normal merge + push is fine.)
   Commit messages must be ASCII-only (CF Pages rejects non-UTF8) — see the `commit` skill.

3. **Watch the deploy and confirm it built.** The push kicks off `deploy-landing.yml`:
   ```bash
   gh run list --workflow=deploy-landing.yml --limit 1
   gh run watch <run-id> --exit-status
   ```
   On failure: `gh run view <run-id> --log-failed | grep -iE "error|resolve|exit code"`.
   IMPORTANT: if the **build** step fails, `wrangler deploy` never runs, so **production is
   untouched** (still the previous version) — you have not broken the live site, just failed to
   update it. Fix forward and push again.

4. **Verify the DEPLOYED bundle (don't trust "workflow succeeded").** Fetch the live hashed JS and
   grep for copy you just changed:
   ```bash
   html=$(curl -s https://reelballers.com)
   js=$(echo "$html" | grep -oE '/assets/index-[^"]+\.js' | head -1)
   curl -s "https://reelballers.com$js" | grep -oE "<a string you added>" | head
   ```
   The hashed filename changing + your new string appearing = the deploy is live.

## Gotchas (summary)
- Separate from the app deploy; triggered by `src/landing/**` on `master`, not a manual wrangler run.
- Local build ≠ CI build because of `@editor` cross-app imports — verify in a clean worktree.
- Shared checkout: land via worktree, never stash/`add -A`.
- Build failure leaves production on the old version (safe); wrangler only runs after a green build.
- Verify the live bundle, not just the green checkmark.
