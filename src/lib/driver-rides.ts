// src/lib/driver-rides.ts
//
// Unified driver-side ride loader. Queries the three booking tables
// (transfers, tours, experiences) in parallel and merges results into
// a single chronological list. Each row carries a `_kind` discriminator
// and a `_table` source pointer so callers can render appropriately and
// route updates back to the correct table.
//
// All three tables share these fields used by the driver views:
//   id, date, time, driver_uid, driver, ride_status,
//   released_to_drivers, total_price, created_at
// Plus type-specific fields:
//   transfers: from, to, vehicle_name, passengers, booking_type
//   tours: tour_id, tour_name, pickup_location, participants
//   experiences: experience_id, experience_name, pickup_location, participants

import { supabase } from './supabase';

export type DriverRideKind = 'transfer' | 'tour' | 'experience';
export type DriverRideTable = 'transfers' | 'tours' | 'experiences';

export interface UnifiedRide {
    _kind: DriverRideKind;
    _table: DriverRideTable;
    id: string;
    date: string;
    time: string;
    driver_uid: string;
    ride_status: string;
    released_to_drivers: boolean;
    total_price: number;
    created_at: string;
    // Transfer-only (also populated for hourly via booking_type='hourly')
    from?: string;
    to?: string;
    vehicle_name?: string;
    passengers?: number;
    booking_type?: string;
    // Tour-only
    tour_id?: string;
    tour_name?: string;
    // Experience-only
    experience_id?: string;
    experience_name?: string;
    // Tour + experience common
    pickup_location?: string;
    participants?: number;
}

function normalizeTransfer(row: any): UnifiedRide {
    return {
        _kind: 'transfer',
        _table: 'transfers',
        id: String(row.id),
        date: String(row.date ?? ''),
        time: String(row.time ?? ''),
        driver_uid: String(row.driver_uid ?? ''),
        ride_status: String(row.ride_status ?? 'new'),
        released_to_drivers: !!row.released_to_drivers,
        total_price: Number(row.total_price) || 0,
        created_at: String(row.created_at ?? ''),
        from: row.from ?? '',
        to: row.to ?? '',
        vehicle_name: row.vehicle_name ?? '',
        passengers: Number(row.passengers) || 0,
        booking_type: row.booking_type ?? 'transfer',
    };
}

function normalizeTour(row: any): UnifiedRide {
    return {
        _kind: 'tour',
        _table: 'tours',
        id: String(row.id),
        date: String(row.date ?? ''),
        time: String(row.time ?? ''),
        driver_uid: String(row.driver_uid ?? ''),
        ride_status: String(row.ride_status ?? 'new'),
        released_to_drivers: !!row.released_to_drivers,
        total_price: Number(row.total_price) || 0,
        created_at: String(row.created_at ?? ''),
        tour_id: row.tour_id ?? '',
        tour_name: row.tour_name ?? '',
        pickup_location: row.pickup_location ?? '',
        participants: Number(row.participants) || 0,
        vehicle_name: row.vehicle_name ?? '',
    };
}

function normalizeExperience(row: any): UnifiedRide {
    return {
        _kind: 'experience',
        _table: 'experiences',
        id: String(row.id),
        date: String(row.date ?? ''),
        time: String(row.time ?? ''),
        driver_uid: String(row.driver_uid ?? ''),
        ride_status: String(row.ride_status ?? 'new'),
        released_to_drivers: !!row.released_to_drivers,
        total_price: Number(row.total_price) || 0,
        created_at: String(row.created_at ?? ''),
        experience_id: row.experience_id ?? '',
        experience_name: row.experience_name ?? '',
        pickup_location: row.pickup_location ?? '',
        participants: Number(row.participants) || 0,
        vehicle_name: row.vehicle_name ?? '',
    };
}

function mergeSorted(...lists: UnifiedRide[][]): UnifiedRide[] {
    const all = lists.flat();
    all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return all;
}

/** Rides released by admin that are unassigned and ready for any driver to claim. */
export async function fetchAvailableRides(): Promise<UnifiedRide[]> {
    const [t, u, e] = await Promise.all([
        supabase.from('transfers')
            .select('*')
            .eq('ride_status', 'new')
            .eq('released_to_drivers', true)
            .order('created_at', { ascending: false }),
        supabase.from('tours')
            .select('*')
            .eq('ride_status', 'new')
            .eq('released_to_drivers', true)
            .order('created_at', { ascending: false }),
        supabase.from('experiences')
            .select('*')
            .eq('ride_status', 'new')
            .eq('released_to_drivers', true)
            .order('created_at', { ascending: false }),
    ]);

    if (t.error) console.error('available transfers load failed:', t.error);
    if (u.error) console.error('available tours load failed:', u.error);
    if (e.error) console.error('available experiences load failed:', e.error);

    const transfers   = (t.data ?? []).map(normalizeTransfer);
    const tours       = (u.data ?? []).map(normalizeTour);
    const experiences = (e.data ?? []).map(normalizeExperience);

    // Client-side: keep only those without a driver_uid (admin-assigned rides drop out
    // of the available pool — they belong to a specific driver via fetchAssignedRides).
    return mergeSorted(transfers, tours, experiences)
        .filter(r => !r.driver_uid);
}

/** Rides assigned to this driver that are not yet completed/cancelled. */
export async function fetchAssignedRides(driverUid: string): Promise<UnifiedRide[]> {
    if (!driverUid) return [];
    const STATUSES = ['assigned', 'pickup', 'onboard'];
    const [t, u, e] = await Promise.all([
        supabase.from('transfers').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
        supabase.from('tours').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
        supabase.from('experiences').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
    ]);

    if (t.error) console.error('assigned transfers load failed:', t.error);
    if (u.error) console.error('assigned tours load failed:', u.error);
    if (e.error) console.error('assigned experiences load failed:', e.error);

    return mergeSorted(
        (t.data ?? []).map(normalizeTransfer),
        (u.data ?? []).map(normalizeTour),
        (e.data ?? []).map(normalizeExperience),
    );
}

/** Rides this driver has completed or had cancelled. */
export async function fetchCompletedRides(driverUid: string): Promise<UnifiedRide[]> {
    if (!driverUid) return [];
    const STATUSES = ['completed', 'cancelled'];
    const [t, u, e] = await Promise.all([
        supabase.from('transfers').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
        supabase.from('tours').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
        supabase.from('experiences').select('*').eq('driver_uid', driverUid).in('ride_status', STATUSES).order('created_at', { ascending: false }),
    ]);

    if (t.error) console.error('past transfers load failed:', t.error);
    if (u.error) console.error('past tours load failed:', u.error);
    if (e.error) console.error('past experiences load failed:', e.error);

    return mergeSorted(
        (t.data ?? []).map(normalizeTransfer),
        (u.data ?? []).map(normalizeTour),
        (e.data ?? []).map(normalizeExperience),
    );
}
