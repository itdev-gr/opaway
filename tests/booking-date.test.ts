import { describe, it, expect } from 'vitest';
import { todayAthens, isPastBookingDate } from '../src/lib/booking-date';

describe('todayAthens', () => {
	it('returns a YYYY-MM-DD string', () => {
		expect(todayAthens()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('is within one day of the system UTC date (Athens is UTC+2/+3)', () => {
		const utc = new Date().toISOString().slice(0, 10);
		const athens = todayAthens();
		const diffDays = Math.abs(
			(new Date(athens + 'T00:00:00Z').getTime() - new Date(utc + 'T00:00:00Z').getTime()) / 86400000
		);
		expect(diffDays).toBeLessThanOrEqual(1);
	});
});

describe('isPastBookingDate', () => {
	it('flags a clearly past date', () => {
		expect(isPastBookingDate('1999-01-01')).toBe(true);
	});

	it('flags yesterday relative to Athens today', () => {
		const t = new Date(todayAthens() + 'T00:00:00Z');
		t.setUTCDate(t.getUTCDate() - 1);
		expect(isPastBookingDate(t.toISOString().slice(0, 10))).toBe(true);
	});

	it('accepts Athens today', () => {
		expect(isPastBookingDate(todayAthens())).toBe(false);
	});

	it('accepts tomorrow and the far future', () => {
		const t = new Date(todayAthens() + 'T00:00:00Z');
		t.setUTCDate(t.getUTCDate() + 1);
		expect(isPastBookingDate(t.toISOString().slice(0, 10))).toBe(false);
		expect(isPastBookingDate('2999-12-31')).toBe(false);
	});

	it('treats the empty string as past (blocked)', () => {
		expect(isPastBookingDate('')).toBe(true);
	});
});
