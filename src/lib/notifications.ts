// src/lib/notifications.ts
import { supabase } from './supabase';

export type AdminCounts = {
    requests: number;
    transfers: number;
    tours: number;
    experiences: number;
    partners: number;
};

/**
 * Counts for the admin sidebar badges. Uses the existing status fields:
 *   - requests.status = 'new'
 *   - transfers/tours/experiences.ride_status = 'new'
 *   - partners.status = 'pending'
 * All queries run in parallel with `head: true, count: 'exact'` — no rows
 * returned, only totals.
 */
export async function adminCounts(): Promise<AdminCounts> {
    const head = (table: string) => supabase.from(table).select('*', { count: 'exact', head: true });
    const [req, tr, to, ex, pa] = await Promise.all([
        head('requests').eq('status', 'new'),
        head('transfers').eq('ride_status', 'new'),
        head('tours').eq('ride_status', 'new'),
        head('experiences').eq('ride_status', 'new'),
        head('partners').eq('status', 'pending'),
    ]);
    return {
        requests: req.count ?? 0,
        transfers: tr.count ?? 0,
        tours: to.count ?? 0,
        experiences: ex.count ?? 0,
        partners: pa.count ?? 0,
    };
}

/**
 * Count of rides that are new, released to drivers, and not yet claimed.
 * Combined across transfers/tours/experiences (driver /available shows
 * all three kinds).
 */
export async function driverAvailableCount(): Promise<number> {
    const head = (table: string) => supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('ride_status', 'new')
        .eq('released_to_drivers', true)
        .or('driver_uid.is.null,driver_uid.eq.');
    const [t, to, ex] = await Promise.all([head('transfers'), head('tours'), head('experiences')]);
    return (t.count ?? 0) + (to.count ?? 0) + (ex.count ?? 0);
}

const partnerSeenKey = (partnerId: string) =>
    `opaway:partner-reservations-seen:${partnerId}`;

/**
 * Count of bookings created since this partner last visited their
 * reservations page. Watermark stored in localStorage, keyed by partner.
 */
export async function partnerReservationsCount(partnerId: string): Promise<number> {
    const lastSeen = (typeof localStorage !== 'undefined' && localStorage.getItem(partnerSeenKey(partnerId)))
        || '1970-01-01T00:00:00Z';
    const head = (table: string) => supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('partner_id', partnerId)
        .gt('created_at', lastSeen);
    const [t, to, ex] = await Promise.all([head('transfers'), head('tours'), head('experiences')]);
    return (t.count ?? 0) + (to.count ?? 0) + (ex.count ?? 0);
}

/** Reset the "new since last visit" watermark for a partner. */
export function markPartnerReservationsSeen(partnerId: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(partnerSeenKey(partnerId), new Date().toISOString());
}

/**
 * Subscribe to every INSERT/UPDATE/DELETE on the given tables. Returns an
 * unsubscribe function. Each table gets its own Supabase channel. Safe to
 * call multiple times (unique channel names keep subscriptions isolated).
 */
export function subscribeTables(tables: string[], onChange: () => void): () => void {
    const channels = tables.map(t =>
        supabase
            .channel(`notif-${t}-${Math.random().toString(36).slice(2, 10)}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: t }, () => onChange())
            .subscribe()
    );
    return () => {
        channels.forEach(ch => supabase.removeChannel(ch));
    };
}
