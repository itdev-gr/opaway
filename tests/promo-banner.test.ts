import { describe, it, expect } from 'vitest';
import { promoStorageKey, DEFAULT_PROMO_KEY } from '../src/lib/promo-banner';

describe('promoStorageKey', () => {
  it('scopes the key to the coupon so a new offer re-appears', () => {
    expect(promoStorageKey('SUMMER25')).toBe('promo:coupon:summer25');
  });

  it('lowercases the code so casing differences share one key', () => {
    expect(promoStorageKey('Summer25')).toBe('promo:coupon:summer25');
  });

  it('falls back to the default key when no coupon is showing', () => {
    expect(promoStorageKey(null)).toBe(DEFAULT_PROMO_KEY);
    expect(promoStorageKey('')).toBe(DEFAULT_PROMO_KEY);
    expect(promoStorageKey('   ')).toBe(DEFAULT_PROMO_KEY);
  });
});
