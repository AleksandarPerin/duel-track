import { describe, expect, it } from 'vitest';
import { selectPendingInOrder } from './syncQueue';

describe('selectPendingInOrder', () => {
  it('sorts oldest createdAt first (FIFO)', () => {
    const records = [
      { id: 'c', createdAt: 300 },
      { id: 'a', createdAt: 100 },
      { id: 'b', createdAt: 200 },
    ];
    expect(selectPendingInOrder(records).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const records = [
      { id: 'b', createdAt: 2 },
      { id: 'a', createdAt: 1 },
    ];
    const original = [...records];
    selectPendingInOrder(records);
    expect(records).toEqual(original);
  });

  it('handles an empty queue', () => {
    expect(selectPendingInOrder([])).toEqual([]);
  });
});
