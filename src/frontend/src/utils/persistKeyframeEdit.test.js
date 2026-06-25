import { describe, it, expect, vi } from 'vitest';
import { persistKeyframeEdit } from './persistKeyframeEdit';

const ok = { success: true };
const fail = { success: false, error: 'boom' };

describe('persistKeyframeEdit', () => {
  it('no-move: emits only add(targetKey), never del', async () => {
    const add = vi.fn().mockResolvedValue(ok);
    const del = vi.fn().mockResolvedValue(ok);
    await persistKeyframeEdit({
      resolution: { targetKey: 30, movedFromKey: null },
      data: { x: 1 },
      actions: { add, del },
      awaited: true,
    });
    expect(add).toHaveBeenCalledWith(30, { x: 1 });
    expect(del).not.toHaveBeenCalled();
  });

  it('move: deletes the old key before adding the new key', async () => {
    const calls = [];
    const add = vi.fn((k) => { calls.push(['add', k]); return Promise.resolve(ok); });
    const del = vi.fn((k) => { calls.push(['del', k]); return Promise.resolve(ok); });
    await persistKeyframeEdit({
      resolution: { targetKey: 30, movedFromKey: 27 },
      data: { x: 1 },
      actions: { add, del },
      awaited: true,
    });
    expect(calls).toEqual([['del', 27], ['add', 30]]);
  });

  it('move where movedFromKey === targetKey: no redundant delete', async () => {
    const del = vi.fn().mockResolvedValue(ok);
    await persistKeyframeEdit({
      resolution: { targetKey: 30, movedFromKey: 30 },
      data: {},
      actions: { add: vi.fn().mockResolvedValue(ok), del },
      awaited: true,
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('the backend key is the resolved targetKey, never a raw value passed separately', async () => {
    // There is no raw-key parameter — add only ever receives resolution.targetKey.
    const add = vi.fn().mockResolvedValue(ok);
    await persistKeyframeEdit({
      resolution: { targetKey: 42, movedFromKey: null },
      data: { y: 2 },
      actions: { add, del: vi.fn() },
      awaited: true,
    });
    expect(add.mock.calls[0][0]).toBe(42);
  });

  it('awaited optimistic write applies on the targetKey then rolls back on failure', async () => {
    const apply = vi.fn();
    const rollbackOpt = vi.fn();
    const rollback = vi.fn();
    const onError = vi.fn();
    await persistKeyframeEdit({
      resolution: { targetKey: 30, movedFromKey: null },
      data: { x: 1 },
      actions: { add: vi.fn().mockResolvedValue(fail), del: vi.fn() },
      optimistic: { apply, rollback: rollbackOpt },
      rollback,
      awaited: true,
      onError,
    });
    expect(apply).toHaveBeenCalledWith(30, { x: 1 });
    expect(rollbackOpt).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('awaited success does not roll back', async () => {
    const rollbackOpt = vi.fn();
    const rollback = vi.fn();
    await persistKeyframeEdit({
      resolution: { targetKey: 30, movedFromKey: null },
      data: {},
      actions: { add: vi.fn().mockResolvedValue(ok), del: vi.fn() },
      optimistic: { apply: vi.fn(), rollback: rollbackOpt },
      rollback,
      awaited: true,
    });
    expect(rollbackOpt).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it('fire-and-forget: never rolls back, routes rejections to onError', async () => {
    const rollback = vi.fn();
    const onError = vi.fn();
    const add = vi.fn().mockRejectedValue(new Error('net'));
    const del = vi.fn().mockRejectedValue(new Error('net'));
    // async fn -> returns a Promise that resolves to undefined and never rejects
    // (overlay ignores it; internal .catch routes rejections to onError).
    const ret = persistKeyframeEdit({
      resolution: { targetKey: 30, movedFromKey: 27 },
      data: {},
      actions: { add, del },
      rollback,
      awaited: false,
      onError,
    });
    await expect(ret).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(rollback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });
});
