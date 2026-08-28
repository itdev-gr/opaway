// Influencer referral capture. A visit to any page with ?ref=<code> stores
// the code for REF_TTL_MS (last click wins); the payment pages read it back
// and send it with the booking payload, where the RPC resolves and snapshots
// the commission server-side. No supabase import here — this module must be
// loadable without env vars (same rule as the pure coupon helpers).

export const REF_STORAGE_KEY = 'opaway:ref';
export const REF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function refFromSearch(search: string): string | null {
  const code = new URLSearchParams(search).get('ref')?.trim() ?? '';
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(code)) return null;
  return code;
}

export function parseStoredRef(raw: string | null, nowMs: number): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const code = typeof parsed?.code === 'string' ? parsed.code.trim() : '';
    const ts = typeof parsed?.ts === 'number' ? parsed.ts : NaN;
    if (!code || !Number.isFinite(ts)) return null;
    if (nowMs - ts > REF_TTL_MS) return null;
    return code;
  } catch {
    return null;
  }
}

export function captureRefFromUrl(): void {
  try {
    const code = refFromSearch(window.location.search);
    if (!code) return;
    localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ code, ts: Date.now() }));
  } catch {
    // localStorage unavailable (private mode etc.) — attribution is best-effort.
  }
}

export function getStoredRefCode(): string | null {
  try {
    return parseStoredRef(localStorage.getItem(REF_STORAGE_KEY), Date.now());
  } catch {
    return null;
  }
}
