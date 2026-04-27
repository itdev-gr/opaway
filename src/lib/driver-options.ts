/**
 * Driver dropdown helper for admin assignment UIs.
 *
 * Queries the `partners` table for approved drivers (type='driver',
 * status='approved') and renders a <select>'s <option> list.
 *
 * Caching: one in-flight promise per page load; resolves to a list
 * stable for the lifetime of the page.
 */
import { supabase } from './supabase';

export interface DriverOption {
  id: string;        // partners.id (= auth.users.id)
  fullName: string;  // partners.full_name
}

let cachedPromise: Promise<DriverOption[]> | null = null;

export function fetchApprovedDrivers(): Promise<DriverOption[]> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    const { data, error } = await supabase
      .from('partners')
      .select('id, full_name')
      .eq('type', 'driver')
      .eq('status', 'approved')
      .order('full_name', { ascending: true });
    if (error) {
      console.error('fetchApprovedDrivers failed:', error);
      return [];
    }
    return (data ?? []).map((d: any) => ({
      id: String(d.id ?? ''),
      fullName: String(d.full_name ?? '').trim() || 'Unnamed driver',
    }));
  })();
  return cachedPromise;
}

const escAttr = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Returns the <option> list as a string for embedding in a <select>.
 *
 * The first option is "Unassigned" with empty value. The matching
 * `currentUid` (if any) is rendered with the `selected` attribute.
 */
export function renderDriverOptionsHTML(
  drivers: DriverOption[],
  currentUid: string,
): string {
  const safeCurrent = currentUid || '';
  const unassignedSelected = safeCurrent === '' ? ' selected' : '';
  const head = `<option value=""${unassignedSelected}>Unassigned</option>`;
  const body = drivers.map(d => {
    const sel = d.id === safeCurrent ? ' selected' : '';
    return `<option value="${escAttr(d.id)}"${sel}>${escAttr(d.fullName)}</option>`;
  }).join('');
  return head + body;
}
