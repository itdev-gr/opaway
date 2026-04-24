// src/lib/commissions.ts
//
// Resolves the commission amount (in EUR) owed to a hotel partner for a
// single booking. Looks up the type-specific column first, falls back to
// the legacy flat `commission_eur`, and returns 0 when nothing is set.
//
// Call site chooses `kind` from the booking row:
//   - transfers: kind = row.booking_type === 'hourly' ? 'hourly' : 'transfer'
//   - tours:     kind = 'tour'
//   - experiences: kind = 'experience'

export type CommissionKind = 'transfer' | 'hourly' | 'tour' | 'experience';

export interface PartnerCommission {
    commission_eur?: number | string | null;
    commission_transfer_eur?: number | string | null;
    commission_hourly_eur?: number | string | null;
    commission_tour_eur?: number | string | null;
    commission_experience_eur?: number | string | null;
}

const COL_FOR_KIND: Record<CommissionKind, keyof PartnerCommission> = {
    transfer: 'commission_transfer_eur',
    hourly: 'commission_hourly_eur',
    tour: 'commission_tour_eur',
    experience: 'commission_experience_eur',
};

function toNumber(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Returns the commission owed for one booking of the given kind, in EUR. */
export function resolveCommissionEur(partner: PartnerCommission | null | undefined, kind: CommissionKind): number {
    if (!partner) return 0;
    const specific = toNumber(partner[COL_FOR_KIND[kind]]);
    if (specific != null) return specific;
    const legacy = toNumber(partner.commission_eur);
    return legacy ?? 0;
}

/** Infer the commission kind from a row from the transfers table. */
export function kindForTransferRow(row: { booking_type?: string | null }): CommissionKind {
    return row.booking_type === 'hourly' ? 'hourly' : 'transfer';
}
