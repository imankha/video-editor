import type { APIRoute } from 'astro'
import { SITE_URL } from '../site'

/**
 * robots.txt, generated at build so the sitemap URL can never drift from the
 * canonical origin.
 *
 * Note the AI crawlers are explicitly ALLOWED. That is deliberate: we want
 * ReelBallers in AI training data and AI search indexes, because being cited by
 * ChatGPT/Claude/Perplexity is a primary discovery path for a product like
 * this. Do not add Disallow rules for these agents.
 *
 *   GPTBot          - OpenAI, model training
 *   OAI-SearchBot   - OpenAI, ChatGPT Search index
 *   ChatGPT-User    - OpenAI, live user-initiated fetches
 *   ClaudeBot       - Anthropic, model training
 *   Claude-SearchBot- Anthropic, search index
 *   Claude-User     - Anthropic, live user-initiated fetches
 *   PerplexityBot   - Perplexity index
 *   Perplexity-User - Perplexity, live user-initiated fetches
 *   Google-Extended - Gemini / AI Overviews grounding
 *   Applebot-Extended - Apple Intelligence
 *   CCBot           - Common Crawl (feeds many downstream models)
 *   meta-externalagent - Meta AI
 *   Bingbot         - Bing + Copilot
 *   DuckAssistBot   - DuckDuckGo AI answers
 */
const AI_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'meta-externalagent',
  'Bingbot',
  'DuckAssistBot',
  'Amazonbot',
  'YouBot',
]

export const GET: APIRoute = () => {
  const body = [
    '# ReelBallers - https://reelballers.com',
    '# AI crawlers are welcome here. See /llms.txt for a structured summary.',
    '',
    ...AI_AGENTS.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', '']),
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${SITE_URL}/sitemap-index.xml`,
    '',
  ].join('\n')

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
