import { describe, it, expect } from 'vitest';
import { validateTsvContent, generateTsvContent } from './useAnnotate';

describe('useAnnotate', () => {
  describe('generateTsvContent', () => {
    it('generates correct header', () => {
      const result = generateTsvContent([]);
      expect(result).toBe('start_time\trating\ttags\tclip_name\tclip_duration\tnotes');
    });

    it('generates correct TSV for single clip', () => {
      const clipRegions = [{
        id: 'clip_1',
        startTime: 150, // 2:30
        endTime: 165,   // 2:45
        name: 'Great Goal',
        tags: ['Goal', 'Dribble'],
        notes: 'Amazing finish',
        rating: 5
      }];

      const result = generateTsvContent(clipRegions);
      const lines = result.split('\n');

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('start_time\trating\ttags\tclip_name\tclip_duration\tnotes');
      expect(lines[1]).toBe('2:30\t5\tGoal,Dribble\tGreat Goal\t15.0\tAmazing finish');
    });

    it('handles empty fields correctly', () => {
      const clipRegions = [{
        id: 'clip_1',
        startTime: 60,
        endTime: 75,
        name: '',
        tags: [],
        notes: '',
        rating: 3
      }];

      const result = generateTsvContent(clipRegions);
      const lines = result.split('\n');

      expect(lines[1]).toBe('1:00\t3\t\t\t15.0\t');
    });

    it('sorts clips by endTime', () => {
      const clipRegions = [
        { id: 'clip_2', startTime: 120, endTime: 135, name: 'Second', tags: [], notes: '', rating: 4 },
        { id: 'clip_1', startTime: 30, endTime: 45, name: 'First', tags: [], notes: '', rating: 5 }
      ];

      const result = generateTsvContent(clipRegions);
      const lines = result.split('\n');

      expect(lines[1]).toContain('First');
      expect(lines[2]).toContain('Second');
    });

    it('sanitizes notes with tabs and newlines', () => {
      const clipRegions = [{
        id: 'clip_1',
        startTime: 0,
        endTime: 15,
        name: 'Test',
        tags: ['Goal'],
        notes: 'Line1\tTab\nNewline\rCarriage',
        rating: 5
      }];

      const result = generateTsvContent(clipRegions);
      const lines = result.split('\n');

      // Notes should have tabs/newlines replaced with spaces
      expect(lines[1]).toContain('Line1 Tab Newline Carriage');
    });

    it('formats duration with one decimal place', () => {
      const clipRegions = [{
        id: 'clip_1',
        startTime: 0,
        endTime: 12.567,
        name: '',
        tags: [],
        notes: '',
        rating: 3
      }];

      const result = generateTsvContent(clipRegions);
      const lines = result.split('\n');
      const parts = lines[1].split('\t');

      expect(parts[4]).toBe('12.6');
    });

    it('handles time over 60 minutes', () => {
      const clipRegions = [{
        id: 'clip_1',
        startTime: 3661, // 61:01
        endTime: 3676,
        name: '',
        tags: [],
        notes: '',
        rating: 3
      }];

      const result = generateTsvContent(clipRegions);
      const lines = result.split('\n');
      const parts = lines[1].split('\t');

      expect(parts[0]).toBe('61:01');
    });

    it('keeps short names unchanged', () => {
      const clipRegions = [{
        id: 'clip_1',
        startTime: 30,
        endTime: 45,
        name: 'Test',
        // Already short names
        tags: ['Pass', 'Dribble', 'Goal'],
        notes: '',
        rating: 5
      }];

      const result = generateTsvContent(clipRegions);
      const lines = result.split('\n');
      const parts = lines[1].split('\t');

      expect(parts[2]).toBe('Pass,Dribble,Goal');
    });
  });

  describe('validateTsvContent', () => {
    it('validates correct TSV', () => {
      const content = `start_time\trating\ttags\tclip_name\tclip_duration\tnotes
2:30\t5\tGoal,Dribble\tGreat Goal\t15.0\tAmazing finish`;

      const result = validateTsvContent(content);

      expect(result.success).toBe(true);
      expect(result.annotations.length).toBe(1);
      expect(result.annotations[0].startTime).toBe(150);
      expect(result.annotations[0].endTime).toBe(165);
      expect(result.annotations[0].rating).toBe(5);
    });

    it('rejects invalid time format', () => {
      const content = `start_time\trating\ttags\tclip_name\tclip_duration\tnotes
2:3\t5\tGoal\tTest\t15.0\t`;

      const result = validateTsvContent(content);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Invalid start_time');
    });

    it('rejects invalid rating', () => {
      const content = `start_time\trating\ttags\tclip_name\tclip_duration\tnotes
2:30\t6\tGoal\tTest\t15.0\t`;

      const result = validateTsvContent(content);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Invalid rating');
    });

    it('rejects invalid tags', () => {
      const content = `start_time\trating\ttags\tclip_name\tclip_duration\tnotes
2:30\t5\tInvalidTag\tTest\t15.0\t`;

      const result = validateTsvContent(content);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Invalid tags');
    });

    it('accepts short tag names on import', () => {
      const content = `start_time\trating\ttags\tclip_name\tclip_duration\tnotes
2:30\t5\tPass,Interception,Dribble\tTest\t15.0\t`;

      const result = validateTsvContent(content);

      expect(result.success).toBe(true);
      expect(result.annotations[0].tags).toEqual(['Pass', 'Interception', 'Dribble']);
    });
  });

  describe('round-trip: export then import', () => {
    it('can import exported TSV content', () => {
      const originalClips = [
        {
          id: 'clip_1',
          startTime: 90,
          endTime: 105,
          name: 'Nice Tackle',
          tags: ['Tackle', 'Interception'],
          notes: 'Clean challenge',
          rating: 4
        },
        {
          id: 'clip_2',
          startTime: 180,
          endTime: 195,
          name: '',
          tags: ['Goal'],
          notes: '',
          rating: 5
        }
      ];

      // Export to TSV
      const tsvContent = generateTsvContent(originalClips);

      // Import back
      const result = validateTsvContent(tsvContent);

      expect(result.success).toBe(true);
      expect(result.annotations.length).toBe(2);

      // First clip (sorted by endTime)
      expect(result.annotations[0].startTime).toBe(90);
      expect(result.annotations[0].name).toBe('Nice Tackle');
      expect(result.annotations[0].rating).toBe(4);

      // Second clip
      expect(result.annotations[1].startTime).toBe(180);
      expect(result.annotations[1].rating).toBe(5);
    });
  });
});
