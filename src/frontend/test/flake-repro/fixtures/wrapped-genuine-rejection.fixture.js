// A real vi.mock failure (its cause is NOT the teardown race) must still fail
// the run WITH the filter: matching walks the cause chain for the race only.
import { test, expect, afterAll } from 'vitest';

test('passes cleanly', () => {
  expect(1).toBe(1);
});

afterAll(() => {
  Promise.resolve().then(() => {
    Promise.reject(new Error(
      '[vitest] There was an error when mocking a module.',
      { cause: new ReferenceError('Cannot access mockFn before initialization') },
    ));
  });
});
