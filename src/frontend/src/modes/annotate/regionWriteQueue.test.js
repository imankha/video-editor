import { describe, it, expect, vi } from 'vitest';
import { createRegionWriteQueue } from './regionWriteQueue';

/** A promise the test can resolve/reject on its own schedule, to prove ordering. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('regionWriteQueue (T10610 § C.1)', () => {
  it('FIFO order within a region: B does not start until A resolves', async () => {
    const queue = createRegionWriteQueue();
    const order = [];
    const a = deferred();

    const pA = queue.enqueue('r1', ['name'], async () => {
      order.push('a-start');
      await a.promise;
      order.push('a-end');
      return { saveOk: true };
    });
    const pB = queue.enqueue('r1', ['notes'], async () => {
      order.push('b-start');
      return { saveOk: true };
    });

    await Promise.resolve().then().then(); // let the queued microtasks reach 'a-start'
    expect(order).toEqual(['a-start']);
    a.resolve();
    await pA;
    await pB;
    expect(order).toEqual(['a-start', 'a-end', 'b-start']);
  });

  it('cross-region independence: different regions never block each other', async () => {
    const queue = createRegionWriteQueue();
    const order = [];
    const a = deferred();

    const pA = queue.enqueue('r1', ['name'], async () => {
      order.push('r1-start');
      await a.promise;
      order.push('r1-end');
      return { saveOk: true };
    });
    const pB = queue.enqueue('r2', ['name'], async () => {
      order.push('r2-start');
      return { saveOk: true };
    });

    await pB;
    expect(order).toEqual(['r1-start', 'r2-start']);
    a.resolve();
    await pA;
    expect(order).toEqual(['r1-start', 'r2-start', 'r1-end']);
  });

  it('a rejected write does not wedge later writes on the same region', async () => {
    const queue = createRegionWriteQueue();

    const pA = queue.enqueue('r1', ['name'], async () => {
      throw new Error('boom');
    });
    await expect(pA).rejects.toThrow('boom');

    const pB = queue.enqueue('r1', ['notes'], async () => ({ saveOk: true }));
    await expect(pB).resolves.toEqual({ saveOk: true });
  });

  it('trim-fails-then-rating-succeeds: settle is false (v2 finding 3)', async () => {
    const queue = createRegionWriteQueue();

    await queue.enqueue('r1', ['startTime', 'endTime'], async () => ({ saveOk: false }));
    await queue.enqueue('r1', ['rating'], async () => ({ saveOk: true }));

    expect(await queue.settle('r1')).toBe(false);
  });

  it('a later successful write of the SAME keys clears them -> settle is true', async () => {
    const queue = createRegionWriteQueue();

    await queue.enqueue('r1', ['startTime', 'endTime'], async () => ({ saveOk: false }));
    expect(await queue.settle('r1')).toBe(false);

    await queue.enqueue('r1', ['startTime', 'endTime'], async () => ({ saveOk: true }));
    expect(await queue.settle('r1')).toBe(true);
  });

  it('settle on a region with no writes ever queued resolves true', async () => {
    const queue = createRegionWriteQueue();
    expect(await queue.settle('unknown-region')).toBe(true);
  });

  it('a thrown (rejected) write also marks its keys failed', async () => {
    const queue = createRegionWriteQueue();
    const p = queue.enqueue('r1', ['name'], async () => {
      throw new Error('network down');
    });
    await expect(p).rejects.toThrow('network down');
    expect(await queue.settle('r1')).toBe(false);
  });

  it('forget clears both the chain and the failure set for a region', async () => {
    const queue = createRegionWriteQueue();
    await queue.enqueue('r1', ['name'], async () => ({ saveOk: false }));
    expect(await queue.settle('r1')).toBe(false);

    queue.forget('r1');
    expect(await queue.settle('r1')).toBe(true);

    // forgetting resets the chain too -- the next enqueue starts a fresh tail,
    // not linked behind the forgotten one.
    const order = [];
    await queue.enqueue('r1', ['name'], async () => {
      order.push('fresh');
      return { saveOk: true };
    });
    expect(order).toEqual(['fresh']);
  });

  it('a queued fn that returns no result object counts as success', async () => {
    const queue = createRegionWriteQueue();
    const fn = vi.fn(async () => undefined);
    await queue.enqueue('r1', ['__create'], fn);
    expect(await queue.settle('r1')).toBe(true);
  });
});
