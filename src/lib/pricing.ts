import { supabase } from './supabase';

export interface PricingRow {
	id: string;
	sedan: number;
	van: number;
	minibus: number;
	sedan_night: number;
	van_night: number;
	minibus_night: number;
}

export interface PricingData {
	transfer: Record<string, PricingRow>;
	hourly: PricingRow;
}

const TRANSFER_BRACKETS = [
	{ id: 'transfer_0_15', from: 0, to: 15 },
	{ id: 'transfer_16_25', from: 16, to: 25 },
	{ id: 'transfer_26_35', from: 26, to: 35 },
	{ id: 'transfer_36_45', from: 36, to: 45 },
	{ id: 'transfer_45_60', from: 45, to: 60 },
	{ id: 'transfer_60_99', from: 60, to: 99 },
];

const DEFAULT_PRICING: PricingData = {
	transfer: {
		transfer_0_15:    { id: 'transfer_0_15', sedan: 70, van: 85, minibus: 150, sedan_night: 100, van_night: 115, minibus_night: 180 },
		transfer_16_25:   { id: 'transfer_16_25', sedan: 75, van: 90, minibus: 162.50, sedan_night: 105, van_night: 120, minibus_night: 192.50 },
		transfer_26_35:   { id: 'transfer_26_35', sedan: 80, van: 100, minibus: 175, sedan_night: 110, van_night: 130, minibus_night: 205 },
		transfer_36_45:   { id: 'transfer_36_45', sedan: 85, van: 105, minibus: 187.50, sedan_night: 115, van_night: 135, minibus_night: 217.50 },
		transfer_45_60:   { id: 'transfer_45_60', sedan: 90, van: 110, minibus: 200, sedan_night: 120, van_night: 140, minibus_night: 230 },
		transfer_60_99:   { id: 'transfer_60_99', sedan: 120, van: 140, minibus: 250, sedan_night: 150, van_night: 170, minibus_night: 280 },
		transfer_100_plus: { id: 'transfer_100_plus', sedan: 1.40, van: 1.70, minibus: 3.50, sedan_night: 1.70, van_night: 2.00, minibus_night: 3.80 },
	},
	hourly: { id: 'hourly', sedan: 60, van: 65, minibus: 80, sedan_night: 70, van_night: 75, minibus_night: 90 },
};

let cachedPricing: PricingData | null = null;

export async function loadPricing(): Promise<PricingData> {
	if (cachedPricing) return cachedPricing;
	try {
		const { data, error } = await supabase.from('pricing').select('*');
		if (error || !data || data.length === 0) return DEFAULT_PRICING;

		const transfer: Record<string, PricingRow> = {};
		let hourly = DEFAULT_PRICING.hourly;

		data.forEach((row: any) => {
			const parsed: PricingRow = {
				id: row.id,
				sedan: Number(row.sedan),
				van: Number(row.van),
				minibus: Number(row.minibus),
				sedan_night: Number(row.sedan_night),
				van_night: Number(row.van_night),
				minibus_night: Number(row.minibus_night),
			};
			if (row.id === 'hourly') hourly = parsed;
			else transfer[row.id] = parsed;
		});

		cachedPricing = { transfer, hourly };
		return cachedPricing;
	} catch {
		return DEFAULT_PRICING;
	}
}

function isNightTime(time: string): boolean {
	if (!time) return false;
	const h = parseInt(time.split(':')[0], 10);
	return h >= 23 || h < 7;
}

export interface PriceInput {
	vehicleSlug: string;
	distanceKm: number;
	durationMinutes: number;
	passengers: number;
	isReturn: boolean;
	discount?: number;
	time?: string;
}

export interface PriceResult {
	outwardPrice: number;
	returnPrice: number;
	totalPrice: number;
	originalTotal: number;
	currency: string;
}

function applyDiscount(price: number, discount?: number): number {
	if (!discount || discount <= 0) return price;
	return Math.round(price * (1 - discount / 100) * 100) / 100;
}

export function calculatePrice(input: PriceInput, pricing: PricingData): PriceResult {
	const night = isNightTime(input.time || '');
	const km = input.distanceKm;
	const slug = input.vehicleSlug as 'sedan' | 'van' | 'minibus';
	const nightKey = `${slug}_night` as keyof PricingRow;

	let outward = 0;

	if (km >= 100) {
		const perKmRow = pricing.transfer['transfer_100_plus'];
		const bracket99 = pricing.transfer['transfer_60_99'];
		if (perKmRow && bracket99) {
			const base99 = night ? Number(bracket99[nightKey]) : Number(bracket99[slug]);
			const perKm = night ? Number(perKmRow[nightKey]) : Number(perKmRow[slug]);
			outward = base99 + (km - 99) * perKm;
		}
	} else {
		let matched = false;
		for (const b of TRANSFER_BRACKETS) {
			if (km >= b.from && km <= b.to) {
				const row = pricing.transfer[b.id];
				if (row) outward = night ? Number(row[nightKey]) : Number(row[slug]);
				matched = true;
				break;
			}
		}
		if (!matched) {
			const fallback = pricing.transfer['transfer_0_15'];
			if (fallback) outward = night ? Number(fallback[nightKey]) : Number(fallback[slug]);
		}
	}

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

export interface HourlyPriceInput {
	vehicleSlug: string;
	hours: number;
	discount?: number;
	time?: string;
}

export function calculateHourlyPrice(input: HourlyPriceInput, pricing: PricingData): { totalPrice: number; originalTotal: number; perHour: number; currency: string } {
	const night = isNightTime(input.time || '');
	const slug = input.vehicleSlug as 'sedan' | 'van' | 'minibus';
	const nightKey = `${slug}_night` as keyof PricingRow;

	const perHour = night ? Number(pricing.hourly[nightKey]) : Number(pricing.hourly[slug]);
	const originalTotal = Math.round(perHour * input.hours * 100) / 100;
	const totalPrice = applyDiscount(originalTotal, input.discount);
	return { totalPrice, originalTotal, perHour, currency: 'EUR' };
}

export function applyPartnerDiscount(price: number, discount?: number): { discountedPrice: number; originalPrice: number } {
	return {
		originalPrice: price,
		discountedPrice: applyDiscount(price, discount),
	};
}
