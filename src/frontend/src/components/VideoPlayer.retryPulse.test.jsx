import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { GuideScope } from './instructions/GuideScope';
import { resolveGuide } from './instructions/resolveGuide';
import { useSettingsStore } from '../stores/settingsStore';

// T12790: the landscape cockpit's only Retry is the player's own, so the video-error
// guide ("Tap Retry Loading Video") must pulse it.
describe('VideoPlayer Retry pulses under the video-error guide (T12790)', () => {
  beforeEach(() => useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } })));

  it('pulses Retry Loading Video', () => {
    const guide = resolveGuide({ screen: 'focus', local: { cockpit: true, videoError: true, canRetryVideo: true } });
    render(
      <GuideScope guides={[guide]}>
        <VideoPlayer videoRef={createRef()} handlers={{}} videoUrl={null} error="Video link expired"
          isUrlExpiredError={() => true} onRetryVideo={() => {}} />
      </GuideScope>
    );
    const retry = screen.getAllByText('Retry Loading Video')[0];
    expect(retry.className).toContain('coach-target-pulse');
  });
});
