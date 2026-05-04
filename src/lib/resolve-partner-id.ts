import { supabase } from './supabase';

/**
 * Returns the approved-partner id for the currently signed-in user, or null
 * if the user is a guest or their partner row is not approved. Used by the
 * three booking-flow payment pages to attribute bookings to a partner.
 */
export async function resolvePartnerId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: partner } = await supabase
    .from('partners')
    .select('id, status')
    .eq('id', user.id)
    .maybeSingle();
  return partner?.status === 'approved' ? partner.id : null;
}
