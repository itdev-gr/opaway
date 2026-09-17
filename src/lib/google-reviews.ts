// Google reviews: the pure half of the sync. Turns what the two Places
// endpoints return into one row shape, decides when two payloads are the same
// review, and builds the requests. No env vars and no supabase import, so it
// loads in unit tests; the network and the database live in
// src/pages/api/admin/sync-google-reviews.ts.
//
// Why two endpoints: Place Details hands back at most five reviews per call.
// The legacy endpoint can sort them newest-first (what we need to catch a new
// review), the New endpoint only returns the five "most relevant". Asking
// both and merging gives the best coverage; either may fail on its own.

export interface ReviewRow {
  dedupe_key: string;
  author_name: string;
  author_url: string | null;
  author_photo_url: string | null;
  rating: number;
  text: string;
  language: string | null;
  published_at: string; // ISO 8601
  google_maps_uri: string | null;
  raw: unknown;
}

export interface PlaceMeta {
  rating: number | null;
  user_ratings_total: number | null;
  place_name: string | null;
  place_url: string | null;
}

// The contributor id is the stable part of the author's Google profile URL
// (https://www.google.com/maps/contrib/<id>/reviews); the same person shows
// up with the same id on both endpoints.
export function contributorId(authorUrl: string | null | undefined): string | null {
  if (!authorUrl) return null;
  const m = authorUrl.match(/\/maps\/contrib\/(\d+)/);
  return m ? m[1] : null;
}

function epochSeconds(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// One key per (author, publish time). A review edited on Google keeps its
// publish time, so the edit updates the stored row instead of adding one.
export function dedupeKeyFor(r: Pick<ReviewRow, 'author_url' | 'author_name' | 'published_at'>): string {
  const t = epochSeconds(r.published_at);
  const id = contributorId(r.author_url);
  return id ? `contrib:${id}:${t}` : `name:${slug(r.author_name) || 'anonymous'}:${t}`;
}

function clampRating(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 1;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Legacy Place Details review object (maps.googleapis.com/maps/api/place/details).
export function normalizeLegacyReview(r: any): ReviewRow | null {
  if (!r || typeof r !== 'object') return null;
  const authorName = str(r.author_name);
  const time = Number(r.time);
  if (!authorName || !Number.isFinite(time) || time <= 0) return null;
  const published_at = new Date(time * 1000).toISOString();
  const row: ReviewRow = {
    dedupe_key: '',
    author_name: authorName,
    author_url: str(r.author_url),
    author_photo_url: str(r.profile_photo_url),
    rating: clampRating(r.rating),
    text: typeof r.text === 'string' ? r.text.trim() : '',
    language: str(r.original_language) ?? str(r.language),
    published_at,
    google_maps_uri: null,
    raw: r,
  };
  row.dedupe_key = dedupeKeyFor(row);
  return row;
}

// Places API (New) review object (places.googleapis.com/v1/places/{id}).
export function normalizeNewReview(r: any): ReviewRow | null {
  if (!r || typeof r !== 'object') return null;
  const authorName = str(r.authorAttribution?.displayName);
  const publishedMs = Date.parse(String(r.publishTime ?? ''));
  if (!authorName || !Number.isFinite(publishedMs)) return null;
  // originalText is what the author wrote; text may be a translation.
  const original = r.originalText?.text ?? r.text?.text;
  const lang = r.originalText?.languageCode ?? r.text?.languageCode;
  const row: ReviewRow = {
    dedupe_key: '',
    author_name: authorName,
    author_url: str(r.authorAttribution?.uri),
    author_photo_url: str(r.authorAttribution?.photoUri),
    rating: clampRating(r.rating),
    text: typeof original === 'string' ? original.trim() : '',
    language: str(lang),
    published_at: new Date(publishedMs).toISOString(),
    google_maps_uri: str(r.googleMapsUri),
    raw: r,
  };
  row.dedupe_key = dedupeKeyFor(row);
  return row;
}

// Unique by dedupe key, newest first. On a clash the row that carries more
// (a Google Maps link, a photo, longer text) wins, so the New endpoint's
// richer object is not thrown away in favour of the legacy one.
export function mergeReviews(rows: (ReviewRow | null)[]): ReviewRow[] {
  const byKey = new Map<string, ReviewRow>();
  for (const row of rows) {
    if (!row) continue;
    const prev = byKey.get(row.dedupe_key);
    if (!prev || richness(row) > richness(prev)) byKey.set(row.dedupe_key, row);
  }
  return [...byKey.values()].sort((a, b) => b.published_at.localeCompare(a.published_at));
}

function richness(r: ReviewRow): number {
  return (r.google_maps_uri ? 4 : 0) + (r.author_photo_url ? 2 : 0) + (r.author_url ? 1 : 0) + r.text.length / 10_000;
}

export function normalizeLegacyMeta(result: any): PlaceMeta {
  return {
    rating: Number.isFinite(Number(result?.rating)) ? Number(result.rating) : null,
    user_ratings_total: Number.isFinite(Number(result?.user_ratings_total)) ? Number(result.user_ratings_total) : null,
    place_name: str(result?.name),
    place_url: str(result?.url),
  };
}

export function normalizeNewMeta(place: any): PlaceMeta {
  return {
    rating: Number.isFinite(Number(place?.rating)) ? Number(place.rating) : null,
    user_ratings_total: Number.isFinite(Number(place?.userRatingCount)) ? Number(place.userRatingCount) : null,
    place_name: str(place?.displayName?.text),
    place_url: str(place?.googleMapsUri),
  };
}

export interface PlacesRequests {
  legacy: { url: string };
  modern: { url: string; headers: Record<string, string> };
}

// The exact requests the sync sends. Pinned by tests so the field lists
// (which drive Google's billing SKU) do not drift by accident.
export function placesRequests(placeId: string, apiKey: string): PlacesRequests {
  const legacy = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  legacy.searchParams.set('place_id', placeId);
  legacy.searchParams.set('fields', 'name,url,rating,user_ratings_total,reviews');
  legacy.searchParams.set('reviews_sort', 'newest');
  legacy.searchParams.set('reviews_no_translations', 'true');
  legacy.searchParams.set('key', apiKey);
  return {
    legacy: { url: legacy.toString() },
    modern: {
      url: `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'displayName,googleMapsUri,rating,userRatingCount,reviews',
      },
    },
  };
}

// ── Presentation helpers for the public cards ──────────────────────────────

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400], ['month', 30 * 86_400], ['week', 7 * 86_400], ['day', 86_400], ['hour', 3_600], ['minute', 60],
];

// "3 weeks ago" in the given locale; "today" for anything under a minute.
export function relativeTime(publishedAtISO: string, nowISO: string, locale = 'en'): string {
  const diff = Math.round((Date.parse(nowISO) - Date.parse(publishedAtISO)) / 1000);
  if (!Number.isFinite(diff)) return '';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) return rtf.format(-Math.round(diff / secs), unit);
  }
  return rtf.format(0, 'day');
}

// Cut long review text at a word boundary so the card keeps its height; the
// full text is still rendered behind a "Read more" toggle.
export function clampText(text: string, max = 220): { short: string; clamped: boolean } {
  const t = text.trim();
  if (t.length <= max) return { short: t, clamped: false };
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return { short: (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…', clamped: true };
}
