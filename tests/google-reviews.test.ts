import { describe, it, expect } from 'vitest';
import {
  clampText, contributorId, dedupeKeyFor, mergeReviews, normalizeLegacyMeta, normalizeLegacyReview,
  normalizeNewMeta, normalizeNewReview, placesRequests, relativeTime,
} from '../src/lib/google-reviews';

const CONTRIB = 'https://www.google.com/maps/contrib/103456789012345678901/reviews';
const EPOCH = 1_757_500_000; // 2025-09-10T10:26:40Z

const legacy = {
  author_name: 'Maria K.',
  author_url: CONTRIB,
  profile_photo_url: 'https://lh3.googleusercontent.com/a/photo=s128',
  rating: 5,
  text: 'Excellent transfer, driver was on time.',
  time: EPOCH,
  language: 'en',
  original_language: 'en',
  relative_time_description: 'a week ago',
};

const modern = {
  name: 'places/ChIJ123/reviews/abc',
  rating: 5,
  text: { text: 'Excellent transfer, driver was on time.', languageCode: 'en' },
  originalText: { text: 'Excellent transfer, driver was on time.', languageCode: 'en' },
  authorAttribution: { displayName: 'Maria K.', uri: CONTRIB, photoUri: 'https://lh3.googleusercontent.com/a/photo=s128' },
  publishTime: new Date(EPOCH * 1000).toISOString(),
  googleMapsUri: 'https://www.google.com/maps/reviews/data=!4m5!14m4!1m3!1m2!1s1!2s2',
};

describe('contributorId', () => {
  it('reads the numeric id out of a contributor URL', () => {
    expect(contributorId(CONTRIB)).toBe('103456789012345678901');
  });
  it('is null for missing or foreign URLs', () => {
    expect(contributorId(null)).toBeNull();
    expect(contributorId('https://example.com/u/1')).toBeNull();
  });
});

describe('normalizeLegacyReview / normalizeNewReview', () => {
  it('produce the same row (bar the Maps link the legacy API lacks) for the same review', () => {
    const a = normalizeLegacyReview(legacy)!;
    const b = normalizeNewReview(modern)!;
    expect(a.dedupe_key).toBe(b.dedupe_key);
    expect(a.dedupe_key).toBe(`contrib:103456789012345678901:${EPOCH}`);
    expect(a.author_name).toBe(b.author_name);
    expect(a.rating).toBe(5);
    expect(b.rating).toBe(5);
    expect(a.text).toBe(b.text);
    expect(a.language).toBe('en');
    expect(b.language).toBe('en');
    expect(a.published_at).toBe(b.published_at);
    expect(a.google_maps_uri).toBeNull();
    expect(b.google_maps_uri).toBe(modern.googleMapsUri);
  });

  it('prefers the original (untranslated) text on the New endpoint', () => {
    const r = normalizeNewReview({
      ...modern,
      text: { text: 'Excellent transfer (translated)', languageCode: 'en' },
      originalText: { text: 'Εξαιρετική μεταφορά', languageCode: 'el' },
    })!;
    expect(r.text).toBe('Εξαιρετική μεταφορά');
    expect(r.language).toBe('el');
  });

  it('tolerates a review with no text, photo or profile URL', () => {
    const r = normalizeLegacyReview({ author_name: 'Anon', rating: '4', time: EPOCH })!;
    expect(r.text).toBe('');
    expect(r.author_photo_url).toBeNull();
    expect(r.author_url).toBeNull();
    expect(r.rating).toBe(4);
    expect(r.dedupe_key).toBe(`name:anon:${EPOCH}`);
  });

  it('clamps a rating outside 1..5 and rejects rows without an author or a time', () => {
    expect(normalizeLegacyReview({ author_name: 'X', rating: 9, time: EPOCH })!.rating).toBe(5);
    expect(normalizeLegacyReview({ author_name: '', rating: 5, time: EPOCH })).toBeNull();
    expect(normalizeLegacyReview({ author_name: 'X', rating: 5 })).toBeNull();
    expect(normalizeNewReview({ ...modern, publishTime: 'not-a-date' })).toBeNull();
    expect(normalizeNewReview(null)).toBeNull();
  });
});

describe('dedupeKeyFor', () => {
  it('falls back to the author name when there is no contributor URL', () => {
    expect(dedupeKeyFor({ author_url: null, author_name: 'Nikos Papadopoulos', published_at: new Date(EPOCH * 1000).toISOString() }))
      .toBe(`name:nikos-papadopoulos:${EPOCH}`);
  });
});

describe('mergeReviews', () => {
  it('collapses the same review from both endpoints and keeps the richer object', () => {
    const merged = mergeReviews([normalizeLegacyReview(legacy), normalizeNewReview(modern)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].google_maps_uri).toBe(modern.googleMapsUri);
  });

  it('orders newest first and drops nulls', () => {
    const older = normalizeLegacyReview({ ...legacy, author_name: 'Old', author_url: null, time: EPOCH - 86_400 });
    const newer = normalizeLegacyReview({ ...legacy, author_name: 'New', author_url: null, time: EPOCH + 86_400 });
    const merged = mergeReviews([older, null, newer]);
    expect(merged.map((r) => r.author_name)).toEqual(['New', 'Old']);
  });
});

describe('meta normalisers', () => {
  it('read the aggregate figures from either endpoint', () => {
    expect(normalizeLegacyMeta({ name: 'Opawey', url: 'https://maps.google.com/?cid=1', rating: 4.9, user_ratings_total: 128 }))
      .toEqual({ rating: 4.9, user_ratings_total: 128, place_name: 'Opawey', place_url: 'https://maps.google.com/?cid=1' });
    expect(normalizeNewMeta({ displayName: { text: 'Opawey' }, googleMapsUri: 'https://maps.google.com/?cid=1', rating: 4.9, userRatingCount: 128 }))
      .toEqual({ rating: 4.9, user_ratings_total: 128, place_name: 'Opawey', place_url: 'https://maps.google.com/?cid=1' });
    expect(normalizeLegacyMeta(undefined)).toEqual({ rating: null, user_ratings_total: null, place_name: null, place_url: null });
  });
});

describe('placesRequests', () => {
  it('asks the legacy endpoint for the newest, untranslated reviews and the New endpoint for the same fields', () => {
    const req = placesRequests('ChIJabc', 'KEY');
    const u = new URL(req.legacy.url);
    expect(u.origin + u.pathname).toBe('https://maps.googleapis.com/maps/api/place/details/json');
    expect(u.searchParams.get('place_id')).toBe('ChIJabc');
    expect(u.searchParams.get('fields')).toBe('name,url,rating,user_ratings_total,reviews');
    expect(u.searchParams.get('reviews_sort')).toBe('newest');
    expect(u.searchParams.get('reviews_no_translations')).toBe('true');
    expect(u.searchParams.get('key')).toBe('KEY');
    expect(req.modern.url).toBe('https://places.googleapis.com/v1/places/ChIJabc');
    expect(req.modern.headers).toEqual({
      'X-Goog-Api-Key': 'KEY',
      'X-Goog-FieldMask': 'displayName,googleMapsUri,rating,userRatingCount,reviews',
    });
  });
});

describe('relativeTime', () => {
  const now = '2026-09-17T12:00:00Z';
  it('picks the largest whole unit', () => {
    expect(relativeTime('2026-09-16T12:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-08-27T12:00:00Z', now)).toBe('3 weeks ago');
    expect(relativeTime('2025-06-01T12:00:00Z', now)).toBe('last year');
  });
  it('says today for anything under a minute and returns empty for garbage', () => {
    expect(relativeTime('2026-09-17T11:59:50Z', now)).toBe('today');
    expect(relativeTime('nope', now)).toBe('');
  });
  it('follows the locale', () => {
    expect(relativeTime('2026-09-10T12:00:00Z', now, 'el')).toContain('εβδομάδα');
  });
});

describe('clampText', () => {
  it('leaves short text alone', () => {
    expect(clampText('Great ride.')).toEqual({ short: 'Great ride.', clamped: false });
  });
  it('cuts at a word boundary and marks the cut', () => {
    const long = 'word '.repeat(80).trim();
    const { short, clamped } = clampText(long, 100);
    expect(clamped).toBe(true);
    expect(short.endsWith('…')).toBe(true);
    expect(short.length).toBeLessThanOrEqual(101);
    expect(short.slice(0, -1).endsWith(' ')).toBe(false);
  });
});
