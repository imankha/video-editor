---
name: commit
description: "Create a git commit with a message that won't be rejected by Cloudflare Pages. Enforces ASCII-only commit messages (no em-dashes, no arrows, no smart quotes) because the CF Pages deploy API (wrangler pages deploy) rejects non-UTF8-compatible characters with code 8000111."
license: MIT
author: video-editor
version: 1.0.0
---

# Commit

Create a git commit whose message will not break the frontend deploy.

## Why this skill exists

On 2026-04-13 a merge commit containing the characters `—` (em-dash) and `→` (arrow) was pushed to master. The Cloudflare Pages deploy workflow (`.github/workflows/deploy-frontend.yml`) failed with:

```
Invalid commit message, it must be a valid UTF-8 string. [code: 8000111]
```

The characters *are* valid UTF-8, but the CF Pages API rejects them. Recovering from this required a manual `workflow_dispatch` rerun. Prevent the class of failure by keeping commit messages ASCII-only.

## Rules

1. **ASCII-only.** The commit message subject and body must contain only characters in the range `0x20–0x7E` plus newline (`0x0A`). Before committing, grep the proposed message for any non-ASCII byte; if found, replace before writing.

2. **Forbidden substitutions (these are the common offenders):**
   | Bad | Use instead |
   |---|---|
   | `—` (em-dash) | `--` or `:` or `-` |
   | `–` (en-dash) | `-` |
   | `→` `←` `↔` (arrows) | `->` `<-` `<->` |
   | `"` `"` `'` `'` (smart quotes) | `"` or `'` |
   | `…` (ellipsis) | `...` |
   | `•` (bullet) | `-` or `*` |
   | `×` (multiply) | `x` |
   | `≥` `≤` | `>=` `<=` |
   | emoji | drop or describe in words |

3. **Verify before pushing to master.** If the commit is on a branch that will merge to master, check the commit message(s) too. Merge commit messages flow through to CF Pages the same way.

4. **Always include the Claude co-author line** (per CLAUDE.md):
   ```
   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   ```

5. **Message via HEREDOC** to preserve formatting, as the project commit convention requires.

## Procedure

1. Draft the commit message.
2. Run `printf '%s' "$MSG" | LC_ALL=C grep -P '[^\x20-\x7E\n]'` (or equivalent) — if it returns anything, replace those characters using the table above.
3. Stage files explicitly (never `git add -A` for anything that might sweep in .env files).
4. Commit via HEREDOC.
5. If on master and pushing, verify `git log -1 --format=%B` is ASCII-only before `git push`.

## If CF Pages already rejected a deploy

1. `gh run view <id> --log-failed` to confirm the `8000111` error.
2. Fix the offending commit message:
   - Newest commit: `git commit --amend` with ASCII-only message.
   - Older commit already pushed: do NOT rewrite history on master. Instead, push a small ASCII-only commit that touches `src/frontend/**` (to re-trigger the path-filtered workflow), or dispatch manually: `gh workflow run deploy-frontend.yml --ref master`.

## When NOT to apply

- Commits on purely-local experimental branches that will never reach master.
- Task documents (*.md content in `docs/plans/`) — those can use any Unicode. This skill gates the *commit message*, not file contents.
