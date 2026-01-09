output "pages_project_name" {
  value = cloudflare_pages_project.pages.name
}

output "r2_bucket" {
  value = cloudflare_r2_bucket.r2_videos.bucket
}
