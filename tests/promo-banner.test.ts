import { describe, it, expect, vi, beforeEach } from 'vitest';

// promo-banner.ts lazy-imports './supabase' *inside* fetchPromoBanner (so the
// module can load without env vars). Mock the exact specifier it resolves to
// from tests/, and make the rpc result mutable per test.
const mockRpc = vi.fn();
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { fetchPromoBanner, promoBannerHref } from '../src/lib/promo-banner';

describe('fetchPromoBanner', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns the banner_text from a normal row, dropping the code', async () => {
    mockRpc.mockResolvedValue({ data: [{ code: 'SUMMER25', banner_text: 'Save 10%', applies_to_all: true, flows: [] }], error: null });
    await expect(fetchPromoBanner()).resolves.toEqual({ banner_text: 'Save 10%', href: '/book' });
  });

  it('returns null when there is no running offer', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchPromoBanner()).resolves.toBeNull();
  });

  it('returns null when the RPC responds with an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchPromoBanner()).resolves.toBeNull();
  });

  it('returns null when banner_text is whitespace only', async () => {
    mockRpc.mockResolvedValue({ data: [{ code: 'SUMMER25', banner_text: '   ' }], error: null });
    await expect(fetchPromoBanner()).resolves.toBeNull();
  });

  it('trims padded banner_text', async () => {
    mockRpc.mockResolvedValue({ data: [{ code: '  SUMMER25  ', banner_text: '  Save 10%  ' }], error: null });
    await expect(fetchPromoBanner()).resolves.toEqual({ banner_text: 'Save 10%', href: '/book' });
  });

  it('still shows the message when the row carries no code', async () => {
    mockRpc.mockResolvedValue({ data: [{ code: '', banner_text: 'Save 10%' }], error: null });
    await expect(fetchPromoBanner()).resolves.toEqual({ banner_text: 'Save 10%', href: '/book' });
  });

  it('sends the visitor to the booking page of the one service the offer is for', async () => {
    mockRpc.mockResolvedValue({ data: [{ code: 'SEP7', banner_text: '7% off transfers', applies_to_all: false, flows: ['transfer'] }], error: null });
    await expect(fetchPromoBanner()).resolves.toEqual({ banner_text: '7% off transfers', href: '/book/transfer' });
  });

  it('returns null when the rpc call throws', async () => {
    mockRpc.mockRejectedValue(new Error('network down'));
    await expect(fetchPromoBanner()).resolves.toBeNull();
  });
});

describe('promoBannerHref', () => {
  it('maps a single service to its booking page', () => {
    expect(promoBannerHref(false, ['transfer'])).toBe('/book/transfer');
    expect(promoBannerHref(false, ['tour'])).toBe('/book/tour');
    expect(promoBannerHref(false, ['hourly'])).toBe('/book/hourly');
  });

  it('falls back to the general booking page for all services, several services, or unknown ones', () => {
    expect(promoBannerHref(true, [])).toBe('/book');
    expect(promoBannerHref(true, ['transfer'])).toBe('/book');
    expect(promoBannerHref(false, ['transfer', 'tour'])).toBe('/book');
    expect(promoBannerHref(false, ['ferry'])).toBe('/book');
    expect(promoBannerHref(false, null)).toBe('/book');
  });
});
