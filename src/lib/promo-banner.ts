// Coupon-driven promo banner. The coupons table has no public read policy, so
// the banner asks get_promo_banner() for the one offer currently advertised —
// it returns only a code and a message, never the discount or the rest of the
// row. No top-level supabase import: this module must load without env vars.

export interface PromoBanner {
  code: string;
  banner_text: string;
}

export const DEFAULT_PROMO_KEY = 'promo:opawey-book-online';

// Dismissal is per-offer: a visitor who closed last month's banner still sees
// the new one, and closing the new one does not un-dismiss the old.
export function promoStorageKey(code: string | null): string {
  const trimmed = (code ?? '').trim();
  return trimmed ? `promo:coupon:${trimmed.toLowerCase()}` : DEFAULT_PROMO_KEY;
}

export async function fetchPromoBanner(): Promise<PromoBanner | null> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.rpc('get_promo_banner');
    if (error) {
      console.error('get_promo_banner failed:', error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const code = typeof row?.code === 'string' ? row.code.trim() : '';
    const text = typeof row?.banner_text === 'string' ? row.banner_text.trim() : '';
    if (!code || !text) return null;
    return { code, banner_text: text };
  } catch (err) {
    console.error('get_promo_banner request failed:', err);
    return null;
  }
}
