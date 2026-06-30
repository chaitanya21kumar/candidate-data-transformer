import { describe, it, expect } from 'vitest';
import { cmp } from '../src/core/order.js';

describe('cmp (deterministic, locale-independent ordering)', () => {
  it('orders by Unicode code unit, not by locale collation', () => {
    // Code-unit order puts all upper-case before lower-case (A=0x41 < a=0x61).
    // A locale collator would interleave them ("apple" < "Banana"); we must NOT.
    const arr = ['Banana', 'apple', 'Cherry', 'banana', 'Apple'];
    const sorted = [...arr].sort(cmp);
    expect(sorted).toEqual(['Apple', 'Banana', 'Cherry', 'apple', 'banana']);
  });

  it('is a correct comparator', () => {
    expect(cmp('a', 'b')).toBeLessThan(0);
    expect(cmp('b', 'a')).toBeGreaterThan(0);
    expect(cmp('x', 'x')).toBe(0);
    expect(cmp('Z', 'a')).toBeLessThan(0);
  });
});
