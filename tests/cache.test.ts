import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use fake timers to control TTL expiry and prevent the setInterval from leaking
vi.useFakeTimers();

import { cacheGet, cacheSet } from '../server/cache.js';

describe('Cache Module', () => {
  const TEST_PREFIX = `test_${Date.now()}_`;

  afterEach(() => {
    // Clean up test keys (best effort)
    try {
      // Keys will expire naturally; no cleanup API needed
    } catch {}
  });

  it('set and get returns stored value', () => {
    const key = `${TEST_PREFIX}basic`;
    const value = { foo: 'bar', num: 42 };

    cacheSet(key, value, 60_000);
    const result = cacheGet<typeof value>(key);

    expect(result).toEqual(value);
  });

  it('returns null for cache miss', () => {
    const result = cacheGet('nonexistent_key_that_does_not_exist');
    expect(result).toBeNull();
  });

  it('returns null after TTL expiry', () => {
    const key = `${TEST_PREFIX}expiry`;
    cacheSet(key, 'hello', 1000); // 1 second TTL

    // Verify it's there
    expect(cacheGet(key)).toBe('hello');

    // Advance time past TTL
    vi.advanceTimersByTime(1500);

    // Should be expired now
    expect(cacheGet(key)).toBeNull();
  });
});
