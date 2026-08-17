import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'

// Guide bodies. Metadata (title, description, dates, ...) lives in
// data/guides.ts -- this collection is the body content only, keyed by the
// same slug, so there is exactly one place each guide's metadata lives.
const guides = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/guides' }),
})

export const collections = { guides }
