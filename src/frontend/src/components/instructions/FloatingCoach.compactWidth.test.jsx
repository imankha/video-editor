import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import Guide from './Guide';
import { resolveGuide } from './resolveGuide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';

// T13160: the Annotate play editor's card is narrow on wide screens so it fits the empty column beside
// the editor, next to Done; phones and tablets keep the full width (a narrower card there is taller and no longer fits).
vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const host = () => document.querySelector('[data-testid="floating-coach-host"]');
const editor = () => resolveGuide({ screen: 'annotate', progress: { selectedPlay: { rating: 3 }, portrait: null }, local: { editorOpen: true } });

beforeEach(() => {
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
});
afterEach(() => { cleanup(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; });

describe('T13160: compact card width', () => {
  it('the play editor card is 22rem from 900px up and keeps the 26rem cap below', async () => {
    const g = editor();
    expect(g.id).toBe('annotate.editor');
    render(<Guide guide={g} />); await flush();
    expect(host().className).toMatch(/w-\[min\(calc\(100vw-24px\),26rem\)\]/);
    expect(host().className).toMatch(/min-\[900px\]:w-\[22rem\]/);
  });
  it('a non-compact card keeps the 26rem width at every size', async () => {
    const g = { ...editor(), compact: false };
    render(<Guide guide={g} />); await flush();
    expect(host().className).not.toMatch(/22rem/);
  });
});
