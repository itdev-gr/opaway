/**
 * Pricing utility for transfer and hourly bookings.
 * Placeholder rates — replace with real values when provided.
 */

export interface PriceInput {
	vehicleSlug: string;
	distanceKm: number;
	durationMinutes: number;
	passengers: number;
	isReturn: boolean;
	discount?: number; // Partner discount percentage (0-100)
}

export interface PriceResult {
	outwardPrice: number;
	returnPrice: number;
	totalPrice: number;
	originalTotal: number; // Price before discount
	currency: string;
}

const BASE_RATES: Record<string, { baseFare: number; perKm: number; perMinute: number }> = {
	'sedan': { baseFare: 25, perKm: 1.2, perMinute: 0.3 },
	'van': { baseFare: 35, perKm: 1.6, perMinute: 0.4 },
	'minibus': { baseFare: 50, perKm: 2.0, perMinute: 0.5 },
};

function applyDiscount(price: number, discount?: number): number {
	if (!discount || discount <= 0) return price;
	return Math.round(price * (1 - discount / 100) * 100) / 100;
}

export function calculatePrice(input: PriceInput): PriceResult {
	const rate = BASE_RATES[input.vehicleSlug] ?? BASE_RATES['sedan'];
	const outward = rate.baseFare + rate.perKm * input.distanceKm + rate.perMinute * input.durationMinutes;
	const outwardBase = Math.round(outward * 100) / 100;
	const returnBase = input.isReturn ? outwardBase : 0;
	const originalTotal = outwardBase + returnBase;

	const outwardPrice = applyDiscount(outwardBase, input.discount);
	const returnPrice = input.isReturn ? applyDiscount(returnBase, input.discount) : 0;

	return {
		outwardPrice,
		returnPrice,
		totalPrice: outwardPrice + returnPrice,
		originalTotal,
		currency: 'EUR',
	};
}

/* ── Hourly pricing ── */

export interface HourlyPriceInput {
	vehicleSlug: string;
	hours: number;
	discount?: number; // Partner discount percentage (0-100)
}

const HOURLY_RATES: Record<string, number> = {
	'sedan': 45,
	'van': 65,
	'minibus': 95,
};

export function calculateHourlyPrice(input: HourlyPriceInput): { totalPrice: number; originalTotal: number; perHour: number; currency: string } {
	const perHour = HOURLY_RATES[input.vehicleSlug] ?? HOURLY_RATES['sedan'];
	const originalTotal = Math.round(perHour * input.hours * 100) / 100;
	const totalPrice = applyDiscount(originalTotal, input.discount);
	return { totalPrice, originalTotal, perHour, currency: 'EUR' };
}

/* ── Apply discount to a fixed price (tours, experiences) ── */
export function applyPartnerDiscount(price: number, discount?: number): { discountedPrice: number; originalPrice: number } {
	return {
		originalPrice: price,
		discountedPrice: applyDiscount(price, discount),
	};
}
