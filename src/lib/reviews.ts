// Approved Google reviews for the public site. The google_reviews table is
// admin-only, so the homepage asks get_public_reviews() / get_public_reviews_meta(),
// which expose approved rows and the aggregate figures and nothing else.
// No top-level supabase import: this module must load without env vars.

// Where a customer goes to write a review (also used by the post-ride email).
export const GOOGLE_REVIEW_URL = 'https://g.page/r/CQvjBfZ0vaQGEAE/review';

export interface PublicReview {
  author_name: string;
  author_photo_url: string | null;
  author_url: string | null;
  rating: number;
  text: string;
  language: string | null;
  published_at: string;
  google_maps_uri: string | null;
}

export interface PublicReviewsMeta {
  rating: number | null;
  user_ratings_total: number | null;
  place_url: string | null;
  approved_count: number;
}

function toPublicReview(row: any): PublicReview | null {
  if (!row || typeof row.author_name !== 'string' || !row.author_name) return null;
  const rating = Number(row.rating);
  if (!Number.isFinite(rating)) return null;
  return {
    author_name: row.author_name,
    author_photo_url: typeof row.author_photo_url === 'string' && row.author_photo_url ? row.author_photo_url : null,
    author_url: typeof row.author_url === 'string' && row.author_url ? row.author_url : null,
    rating: Math.min(5, Math.max(1, Math.round(rating))),
    text: typeof row.text === 'string' ? row.text : '',
    language: typeof row.language === 'string' && row.language ? row.language : null,
    published_at: String(row.published_at ?? ''),
    google_maps_uri: typeof row.google_maps_uri === 'string' && row.google_maps_uri ? row.google_maps_uri : null,
  };
}

export async function fetchPublicReviews(limit = 12): Promise<PublicReview[]> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.rpc('get_public_reviews', { p_limit: limit });
    if (error) {
      console.error('get_public_reviews failed:', error);
      return [];
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows.map(toPublicReview).filter((r): r is PublicReview => r !== null);
  } catch (err) {
    console.error('get_public_reviews request failed:', err);
    return [];
  }
}

export async function fetchPublicReviewsMeta(): Promise<PublicReviewsMeta | null> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.rpc('get_public_reviews_meta');
    if (error) {
      console.error('get_public_reviews_meta failed:', error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    return {
      rating: num(row.rating),
      user_ratings_total: num(row.user_ratings_total),
      place_url: typeof row.place_url === 'string' && row.place_url ? row.place_url : null,
      approved_count: num(row.approved_count) ?? 0,
    };
  } catch (err) {
    console.error('get_public_reviews_meta request failed:', err);
    return null;
  }
}
