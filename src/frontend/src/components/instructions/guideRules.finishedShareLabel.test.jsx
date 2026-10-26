import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GUIDE } from '../../config/displayNames';
import { GuideScope } from './GuideScope';
import { PublishLinkFlow } from '../PublishLinkFlow';

// T13450: the finished-viewer sentence names the label RENDERED on the pulsed button, in both
// states the coach shows in (idle trigger, and the link-less ready card), not only the constant.
describe('T13450 finished viewer names the rendered share button', () => {
  const named = GUIDE.finished.viewer.match(/Tap (.+?) to send it/)[1];
  it.each(['idle', 'ready'])('%s phase button reads the label the guide names', (phase) => {
    render(<GuideScope guides={[]}><PublishLinkFlow phase={phase} shareUrl={null} onGetLink={() => {}} onPublishClick={() => {}} /></GuideScope>);
    expect(screen.getByTestId('finished-get-link').textContent).toBe(named);
  });
});
