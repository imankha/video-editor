import { describe, it, expect } from 'vitest';
import { validateTsvContent } from './useAnnotate';

const HEADER = 'start_time\trating\ttags\tclip_name\tclip_duration\tnotes';
const firstError = (content) => validateTsvContent(content).errors[0];

describe('T14530: import file errors', () => {
  it.each([
    ['start time', `${HEADER}\nsoon\t4\t\t\t10\t`, 'Line 2: the start time should look like 12:30'],
    ['rating', `${HEADER}\n1:00\t9\t\t\t10\t`, 'Line 2: the rating should be a number from 1 to 5'],
    ['length', `${HEADER}\n1:00\t4\t\t\tlong\t`, 'Line 2: the play length should be a number of seconds, like 12.5'],
    ['length precision', `${HEADER}\n1:00\t4\t\t\t1.25\t`, 'Line 2: the play length should be a number of seconds, like 12.5'],
  ])('T14530:C6 a bad %s reads plainly', (_name, content, expected) => {
    expect(firstError(content)).toBe(expected);
  });

  it('T14530:C6 a bad header names no column ids', () => {
    expect(firstError('nope\theader\n')).not.toMatch(/start_time|clip_duration|clip_name|header|column/i);
  });

  it('T14530:C6 a file with no rows says there are no plays', () => {
    expect(firstError(`${HEADER}\n`)).toMatch(/no plays/i);
  });
});
