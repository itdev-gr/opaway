import { describe, it, expect, vi, beforeEach } from 'vitest';

// reviews.ts lazy-imports './supabase' inside each fetch so the module loads
// without env vars. Mock the specifier it resolves to from tests/.
const mockRpc = vi.fn();
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { fetchPublicReviews, fetchPublicReviewsMeta, GOOGLE_REVIEW_URL } from '../src/lib/reviews';

describe('fetchPublicReviews', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('asks the RPC with the limit it was given', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchPublicReviews(6);
    expect(mockRpc).toHaveBeenCalledWith('get_public_reviews', { p_limit: 6 });
  });

  it('normalises rows and drops ones with no author', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { author_name: 'Maria', author_photo_url: '', author_url: null, rating: '5', text: 'Great', language: 'en', published_at: '2026-09-01T00:00:00+00:00', google_maps_uri: null },
        { author_name: '', rating: 5 },
      ],
      error: null,
    });
    await expect(fetchPublicReviews()).resolves.toEqual([{
      author_name: 'Maria', author_photo_url: null, author_url: null, rating: 5, text: 'Great',
      language: 'en', published_at: '2026-09-01T00:00:00+00:00', google_maps_uri: null,
    }]);
  });

  it('returns nothing on an RPC error, so the section stays hidden', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchPublicReviews()).resolves.toEqual([]);
  });

  it('returns nothing when the request throws', async () => {
    mockRpc.mockRejectedValue(new Error('network down'));
    await expect(fetchPublicReviews()).resolves.toEqual([]);
  });
});

describe('fetchPublicReviewsMeta', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('reads the aggregate figures', async () => {
    mockRpc.mockResolvedValue({ data: [{ rating: '4.9', user_ratings_total: 128, place_url: 'https://maps.google.com/?cid=1', approved_count: '3' }], error: null });
    await expect(fetchPublicReviewsMeta()).resolves.toEqual({ rating: 4.9, user_ratings_total: 128, place_url: 'https://maps.google.com/?cid=1', approved_count: 3 });
  });

  it('is null before the first sync has filled the row', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchPublicReviewsMeta()).resolves.toBeNull();
  });

  it('is null on an RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchPublicReviewsMeta()).resolves.toBeNull();
  });

  it('keeps nulls for figures Google has not supplied yet', async () => {
    mockRpc.mockResolvedValue({ data: [{ rating: null, user_ratings_total: null, place_url: null, approved_count: 0 }], error: null });
    await expect(fetchPublicReviewsMeta()).resolves.toEqual({ rating: null, user_ratings_total: null, place_url: null, approved_count: 0 });
  });
});

describe('GOOGLE_REVIEW_URL', () => {
  it('points at the Google review form', () => {
    expect(GOOGLE_REVIEW_URL).toMatch(/^https:\/\/g\.page\/r\/.+\/review$/);
  });
});
