// Coupon-driven promo banner. The coupons table has no public read policy, so
// the banner asks get_promo_banner() for the one offer currently advertised.
// The RPC also returns that offer's code, which this deliberately drops:
// coupons apply themselves to the prices now, so there is no code to hand out.
// No top-level supabase import: this module must load without env vars.

export interface PromoBanner {
  banner_text: string;
  // Where "Book now" goes: the booking page of the offer's service when it
  // targets exactly one, otherwise the general booking page.
  href: string;
}

const FLOW_PAGES: Record<string, string> = {
  transfer: '/book/transfer',
  hourly: '/book/hourly',
  tour: '/book/tour',
};

export function promoBannerHref(appliesToAll: boolean, flows: string[] | null | undefined): string {
  if (appliesToAll || !Array.isArray(flows) || flows.length !== 1) return '/book';
  return FLOW_PAGES[flows[0]] ?? '/book';
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
    const text = typeof row?.banner_text === 'string' ? row.banner_text.trim() : '';
    if (!text) return null;
    return {
      banner_text: text,
      href: promoBannerHref(row.applies_to_all !== false, row.flows),
    };
  } catch (err) {
    console.error('get_promo_banner request failed:', err);
    return null;
  }
}
