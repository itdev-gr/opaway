import { describe, it, expect } from 'vitest';
import { refFromSearch, parseStoredRef, REF_TTL_MS } from '../src/lib/influencer-ref';

describe('refFromSearch', () => {
  it('extracts the ref param', () => {
    expect(refFromSearch('?ref=maria123')).toBe('maria123');
  });

  it('trims whitespace and ignores other params', () => {
    expect(refFromSearch('?utm_source=ig&ref=%20maria%20')).toBe('maria');
  });

  it('returns null when absent or empty', () => {
    expect(refFromSearch('')).toBeNull();
    expect(refFromSearch('?foo=1')).toBeNull();
    expect(refFromSearch('?ref=')).toBeNull();
    expect(refFromSearch('?ref=%20%20')).toBeNull();
  });

  it('rejects absurdly long values', () => {
    expect(refFromSearch(`?ref=${'x'.repeat(65)}`)).toBeNull();
    expect(refFromSearch(`?ref=${'x'.repeat(64)}`)).toBe('x'.repeat(64));
  });
});

describe('parseStoredRef', () => {
  const now = 1_800_000_000_000;
  const stored = (code: string, ts: number) => JSON.stringify({ code, ts });

  it('returns the code while inside the TTL window', () => {
    expect(parseStoredRef(stored('maria', now - 1000), now)).toBe('maria');
    expect(parseStoredRef(stored('maria', now - REF_TTL_MS), now)).toBe('maria');
  });

  it('expires strictly after the TTL', () => {
    expect(parseStoredRef(stored('maria', now - REF_TTL_MS - 1), now)).toBeNull();
  });

  it('returns null for null, garbage, or malformed payloads', () => {
    expect(parseStoredRef(null, now)).toBeNull();
    expect(parseStoredRef('not json', now)).toBeNull();
    expect(parseStoredRef(JSON.stringify({ code: '', ts: now }), now)).toBeNull();
    expect(parseStoredRef(JSON.stringify({ code: 'x' }), now)).toBeNull();
    expect(parseStoredRef(JSON.stringify({ ts: now }), now)).toBeNull();
    expect(parseStoredRef(JSON.stringify({ code: 'x', ts: 'soon' }), now)).toBeNull();
  });
});
