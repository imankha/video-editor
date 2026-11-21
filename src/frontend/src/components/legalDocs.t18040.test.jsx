import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrivacyPolicy } from './PrivacyPolicy';
import { TermsOfService } from './TermsOfService';

/**
 * T18040:C6 - docs/legal/privacy-policy.md and terms-of-service.md match the live pages
 * (/privacy and /terms) and carry the approval date.
 *
 * Renders each page and compares its visible text with the markdown with formatting
 * stripped, section by section: the text before the first section, then each "N. Title"
 * section. Whitespace is ignored (block elements render without separators in the DOM),
 * every word and character must match in order.
 */

const LEGAL = resolve(__dirname, '../../../../docs/legal');
const APPROVAL = 'Approved by legal counsel on November 20, 2026.';

const squash = (text) => text.replace(/\s+/g, '');

// Markdown -> the words a reader sees: drop emphasis, code ticks, list bullets, heading marks
// and table pipes.
function markdownText(md) {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|`/g, '')
    .replace(/^#{1,6} /gm, '')
    .replace(/^\s*(?:[-*]|\d+\.) /gm, '')
    .replace(/^---$/gm, '')
    .replace(/^\|(?:\s*-+\s*\|)+\s*$/gm, '')
    .replace(/\|/g, '');
}

// The markdown body (after the header block's ---) split into [intro, ...sections].
function markdownSections(file) {
  const md = readFileSync(resolve(LEGAL, file), 'utf8');
  const [header, body] = md.split(/^---$/m);
  const parts = body.split(/^## /m);
  return {
    header,
    intro: squash(markdownText(parts[0])),
    // A section's first line is its "N. Title" heading, kept as written.
    sections: parts.slice(1).map((part) => {
      const [title, ...rest] = part.split('\n');
      return squash(title + markdownText(rest.join('\n')));
    }),
  };
}

// The rendered page split the same way: the text between the contents list and the first
// section, then each <section> (its heading included).
function pageSections(Page) {
  const { container } = render(<Page />);
  const sections = [...container.querySelectorAll('section')];
  let intro = '';
  for (let node = container.querySelector('nav').nextElementSibling; node && node !== sections[0]; node = node.nextElementSibling) {
    intro += node.textContent;
  }
  const result = { intro: squash(intro), sections: sections.map((s) => squash(s.textContent)) };
  cleanup();
  return result;
}

describe.each([
  ['privacy-policy.md', PrivacyPolicy],
  ['terms-of-service.md', TermsOfService],
])('T18040:C6 %s matches the live page', (file, Page) => {
  it('T18040:C6 carries the approval date and the page\'s Last Updated date', () => {
    const { header } = markdownSections(file);
    expect(header).toContain(APPROVAL);
    expect(header).not.toMatch(/draft/i);
    const { container } = render(<Page />);
    const lastUpdated = container.textContent.match(/Last updated: ([A-Za-z]+ \d+, \d{4})/)[1];
    cleanup();
    expect(header).toContain(`**Last Updated:** ${lastUpdated}`);
  });

  it('T18040:C6 every section has the same text as the page', () => {
    const md = markdownSections(file);
    const page = pageSections(Page);
    expect(md.intro).toBe(page.intro);
    expect(md.sections.length).toBe(page.sections.length);
    md.sections.forEach((section, i) => {
      expect(section, `section ${i + 1}`).toBe(page.sections[i]);
    });
  });
});
