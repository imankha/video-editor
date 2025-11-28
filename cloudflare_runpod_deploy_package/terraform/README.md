Terraform folder - purpose & notes

This directory contains a Terraform-style declarative spec that declares the Cloudflare resources you will need. Some Cloudflare resources (D1) are created via Wrangler migrations; this Terraform spec focuses on DNS, Pages project, R2 bucket, Worker routes, and Secrets.

Important notes:
- Replace placeholders (zone_id, account_id, runpod_api_key_secret_name) with your real values.
- Some resources are implemented with `null_resource` placeholders where provider support varies; you can replace them with the provider-specific resource if available.
- This repo intentionally uses a simple, readable Terraform layout for AI consumption. Validate with `terraform init` and `terraform plan` in your environment and adjust provider versions as needed.
