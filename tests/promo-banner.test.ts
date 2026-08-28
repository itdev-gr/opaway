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

import { fetchPromoBanner } from '../src/lib/promo-banner';

describe('fetchPromoBanner', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns the code and banner_text from a normal row', async () => {
    mockRpc.mockResolvedValue({ data: [{ code: 'SUMMER25', banner_text: 'Save 10%' }], error: null });
    await expect(fetchPromoBanner()).resolves.toEqual({ code: 'SUMMER25', banner_text: 'Save 10%' });
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

  it('trims padded code and banner_text', async () => {
    mockRpc.mockResolvedValue({ data: [{ code: '  SUMMER25  ', banner_text: '  Save 10%  ' }], error: null });
    await expect(fetchPromoBanner()).resolves.toEqual({ code: 'SUMMER25', banner_text: 'Save 10%' });
  });

  it('returns null when the rpc call throws', async () => {
    mockRpc.mockRejectedValue(new Error('network down'));
    await expect(fetchPromoBanner()).resolves.toBeNull();
  });
});
