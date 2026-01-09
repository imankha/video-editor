Wrangler project - local dev and deploy

Prerequisites:
- Node.js >= 18
- wrangler CLI installed (https://developers.cloudflare.com/workers/cli-wrangler/)
- A Cloudflare account & API token
- Stripe test keys
- (Optional) RunPod API key for job invocation

Local development:
- `wrangler dev` runs a local Worker runtime for testing.
- D1 migrations are in `migrations/` and can be applied via `wrangler d1 migrations apply --database wallet-db`.

Deployment:
- Configure `wrangler.toml` with your account_id, zone_id, and environment secrets.
- `wrangler publish` to push Worker(s).
- Use `wrangler pages publish` or the Cloudflare UI to deploy Pages if not using Git integration.
