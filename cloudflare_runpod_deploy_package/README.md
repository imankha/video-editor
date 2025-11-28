# AI-First Cloudflare + RunPod Architecture (MVP)

This repository contains everything an AI (or human) needs to understand and deploy the **Cloudflare + RunPod** architecture for a prepaid wallet-enabled app using **Stripe** as the payment/identity provider.

**Structure**
- `terraform/` - Terraform-style declarative spec for Cloudflare resources and placeholders for external services
- `wrangler/` - Wrangler project with Cloudflare Worker code, `wrangler.toml`, and D1 migrations
- `system_prompt.txt` - Short AI-ready system prompt that references README for details
- `LICENSE` - MIT

**High level**
- Frontend: Cloudflare Pages (static React/Vite)
- Edge API: Cloudflare Workers (top-up, Stripe webhook, debit + RunPod job)
- Wallet DB: Cloudflare D1 (small SQL wallet + ledger)
- Storage: Cloudflare R2 (video outputs)
- Payments/identity: Stripe (customers & saved payment methods)
- GPU compute: RunPod (Docker jobs)
- Logging: OpenObserve (optional, self-hosted)
- Analytics: Plausible (optional, self-hosted)

See `wrangler/README.md` for local dev & testing instructions and `terraform/README.md` for provisioning notes.
