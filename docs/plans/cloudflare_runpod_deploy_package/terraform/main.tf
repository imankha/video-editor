terraform {
  required_version = ">= 1.2.0"
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
  account_id = var.cloudflare_account_id
}

resource "cloudflare_pages_project" "pages" {
  account_id = var.cloudflare_account_id
  name       = var.pages_project_name
  production_branch = "main"
  build_config {
    build_command = "npm run build"
    directory     = "dist"
  }
}

resource "cloudflare_r2_bucket" "r2_videos" {
  account_id = var.cloudflare_account_id
  bucket = var.r2_bucket_name
}

resource "cloudflare_worker_route" "api_route" {
  zone_id = var.cloudflare_zone_id
  pattern = "api.${var.domain}/*"
  script_name = var.worker_script_name
}

resource "cloudflare_record" "www" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "A"
  value   = "192.0.2.1"
  ttl     = 1
  proxied = true
}

resource "null_resource" "d1_placeholder" {
  provisioner "local-exec" {
    command = "echo 'D1 migrations handled via wrangler d1 migrations apply'"
  }
}

resource "null_resource" "secrets_note" {
  provisioner "local-exec" {
    command = "echo 'Set STRIPE_SECRET, STRIPE_WEBHOOK_SECRET, RUNPOD_API_KEY via wrangler or Cloudflare API'"
  }
}
