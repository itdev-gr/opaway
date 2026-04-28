// src/lib/commissions.ts
//
// Resolves the commission amount (in EUR) owed to a hotel partner for a
// single booking under the new per-vehicle / per-type-percentage model.
//
// Transfers (kind='transfer'/'hourly') -> fix EUR per vehicle class
//   commission_transfer_sedan_eur   for vehicle_name matching /sedan/i
//   commission_transfer_van_eur     for vehicle_name matching /van/i (and not "minibus")
//   commission_transfer_minibus_eur for vehicle_name matching /minibus/i
//
// Hourly bookings still use the per-vehicle EUR (they ride in the same vehicle classes).
//
// Tours / experiences -> percentage of total_price.
//   commission_tour_pct       for kind='tour'
//   commission_experience_pct for kind='experience'
//
// Returns 0 when the relevant column is null / missing / non-numeric.

export type CommissionKind = 'transfer' | 'hourly' | 'tour' | 'experience';

export interface PartnerCommission {
    // New per-vehicle EUR columns (transfers + hourly use these)
    commission_transfer_sedan_eur?: number | string | null;
    commission_transfer_van_eur?: number | string | null;
    commission_transfer_minibus_eur?: number | string | null;
    // New per-type percentage columns
    commission_hourly_pct?: number | string | null;
    commission_tour_pct?: number | string | null;
    commission_experience_pct?: number | string | null;
}

export interface CommissionBooking {
    kind: CommissionKind;
    vehicle_name?: string | null;
    total_price?: number | string | null;
}

export type VehicleClass = 'sedan' | 'van' | 'minibus' | 'unknown';

function toNumber(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Map a free-text vehicle_name to one of three classes.
 * Order matters: minibus is checked before van because "minibus" contains "bus" but not
 * "van", and we don't want false positives. "Sedan" is matched last as a fallback when
 * a row mentions a model only.
 */
export function classifyVehicle(vehicleName: string | null | undefined): VehicleClass {
    if (!vehicleName) return 'unknown';
    const v = vehicleName.toLowerCase();
    if (v.includes('minibus')) return 'minibus';
    if (v.includes('van')) return 'van';
    if (v.includes('sedan')) return 'sedan';
    return 'unknown';
}

/** Resolves the commission EUR for one booking. */
export function resolveHotelCommission(
    partner: PartnerCommission | null | undefined,
    booking: CommissionBooking,
): number {
    if (!partner) return 0;

    if (booking.kind === 'transfer' || booking.kind === 'hourly') {
        const cls = classifyVehicle(booking.vehicle_name);
        if (cls === 'sedan')   return toNumber(partner.commission_transfer_sedan_eur)   ?? 0;
        if (cls === 'van')     return toNumber(partner.commission_transfer_van_eur)     ?? 0;
        if (cls === 'minibus') return toNumber(partner.commission_transfer_minibus_eur) ?? 0;
        // Unknown vehicle: pick the smallest configured rate as a conservative default,
        // or 0 if none. Better to under-pay than over-pay; admin can fix the row.
        const candidates = [
            toNumber(partner.commission_transfer_sedan_eur),
            toNumber(partner.commission_transfer_van_eur),
            toNumber(partner.commission_transfer_minibus_eur),
        ].filter((n): n is number => n != null);
        return candidates.length ? Math.min(...candidates) : 0;
    }

    // tour / experience: percentage × total_price
    const total = toNumber(booking.total_price) ?? 0;
    if (total <= 0) return 0;
    const pctRaw = booking.kind === 'tour'
        ? toNumber(partner.commission_tour_pct)
        : toNumber(partner.commission_experience_pct);
    if (pctRaw == null || pctRaw <= 0) return 0;
    // Round to cents.
    return Math.round(total * pctRaw) / 100;
}

/** Backwards-compatible thin wrapper. */
export function resolveCommissionEur(
    partner: PartnerCommission | null | undefined,
    kind: CommissionKind,
    extra?: { vehicle_name?: string | null; total_price?: number | string | null },
): number {
    return resolveHotelCommission(partner, {
        kind,
        vehicle_name: extra?.vehicle_name,
        total_price: extra?.total_price,
    });
}

/** Infer the commission kind from a row from the transfers table. */
export function kindForTransferRow(row: { booking_type?: string | null }): CommissionKind {
    return row.booking_type === 'hourly' ? 'hourly' : 'transfer';
}
