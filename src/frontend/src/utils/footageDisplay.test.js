import { describe, it, expect } from 'vitest';
import { overlapSentence, shortLabel } from './footageDisplay';

function item(name, { duration = 60, creationTime = null } = {}) {
  return { name, size: 1024, duration, creationTime, file: new File(['x'], name) };
}

describe('overlapSentence', () => {
  it('one partner: "{duration} - overlaps {partner} from {clock} to {clock}"', () => {
    const angle = item('sideline.mp4', { duration: 240, creationTime: new Date('2026-09-05T18:25:00') });
    const partner = item('DJI_0004.MP4');
    expect(overlapSentence(angle, [partner])).toBe(
      `4 min - overlaps DJI_0004 from ${angle.creationTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to ` +
        `${new Date(angle.creationTime.getTime() + 240000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    );
  });

  it('two partners join as "{first} and {second}"', () => {
    const angle = item('dads-phone.mp4', { duration: 480, creationTime: new Date('2026-09-05T18:27:00') });
    const partners = [item('DJI_0004.MP4'), item('sideline.mp4')];
    const sentence = overlapSentence(angle, partners);
    expect(sentence).toContain('overlaps DJI_0004 and sideline');
    expect(sentence.startsWith('8 min')).toBe(true);
  });

  it('truncates a long partner name via shortLabel', () => {
    const angle = item('a.mp4', { duration: 60, creationTime: new Date('2026-09-05T18:00:00') });
    const partner = item('DJI_20260718120831_0006_D.MP4');
    expect(overlapSentence(angle, [partner])).toContain(shortLabel(partner.name));
  });

  it('omits the clock range when the angle has no usable creationTime', () => {
    const angle = item('a.mp4', { duration: 60, creationTime: null });
    expect(overlapSentence(angle, [item('b.mp4')])).toBe('1 min - overlaps b');
  });
});

describe('shortLabel', () => {
  it('returns the filename stem unchanged when 14 chars or fewer', () => {
    expect(shortLabel('clip.mp4')).toBe('clip');
  });

  it('middle-ellipsis-truncates a long stem to 14 characters total', () => {
    const label = shortLabel('DJI_20260718120831_0006_D.MP4');
    expect(label.length).toBe(14);
    expect(label).toContain('…');
    expect(label.startsWith('DJI_202')).toBe(true);
    expect(label.endsWith('0006_D')).toBe(true);
  });
});
