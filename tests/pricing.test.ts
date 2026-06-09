import { describe, it, expect } from 'vitest';
import { calculatePrice, type PricingData } from '../src/lib/pricing';

// Unique sedan value per bracket so the assertion reveals which bracket matched.
const PRICING: PricingData = {
  transfer: {
    transfer_0_15:     { id: 'transfer_0_15',     sedan: 10, van: 11, minibus: 12, sedan_night: 110, van_night: 111, minibus_night: 112 },
    transfer_16_25:    { id: 'transfer_16_25',    sedan: 20, van: 21, minibus: 22, sedan_night: 120, van_night: 121, minibus_night: 122 },
    transfer_26_35:    { id: 'transfer_26_35',    sedan: 30, van: 31, minibus: 32, sedan_night: 130, van_night: 131, minibus_night: 132 },
    transfer_36_45:    { id: 'transfer_36_45',    sedan: 40, van: 41, minibus: 42, sedan_night: 140, van_night: 141, minibus_night: 142 },
    transfer_45_60:    { id: 'transfer_45_60',    sedan: 50, van: 51, minibus: 52, sedan_night: 150, van_night: 151, minibus_night: 152 },
    transfer_60_99:    { id: 'transfer_60_99',    sedan: 60, van: 61, minibus: 62, sedan_night: 160, van_night: 161, minibus_night: 162 },
    transfer_100_plus: { id: 'transfer_100_plus', sedan: 1,  van: 2,  minibus: 3,  sedan_night: 1,   van_night: 2,   minibus_night: 3   },
  },
  hourly: { id: 'hourly', sedan: 60, van: 65, minibus: 80, sedan_night: 70, van_night: 75, minibus_night: 90 },
};

const price = (km: number, slug = 'sedan') =>
  calculatePrice(
    { vehicleSlug: slug, distanceKm: km, durationMinutes: 0, passengers: 2, isReturn: false, time: '12:00' },
    PRICING,
  ).outwardPrice;

describe('calculatePrice — contiguous brackets (no gaps)', () => {
  it('REGRESSION: 25.3 km uses the 26-35 bracket, NOT the cheapest fallback', () => {
    expect(price(25.3)).toBe(30);
  });

  it('maps each boundary distance to the correct bracket', () => {
    expect(price(0)).toBe(10);
    expect(price(15)).toBe(10);
    expect(price(15.5)).toBe(20);
    expect(price(16)).toBe(20);
    expect(price(25)).toBe(20);
    expect(price(25.3)).toBe(30);
    expect(price(35)).toBe(30);
    expect(price(35.5)).toBe(40);
    expect(price(45)).toBe(40);
    expect(price(60)).toBe(50);
    expect(price(99)).toBe(60);
  });

  it('bills per-km above 99 km with the 60-99 base (no gap at 99-100)', () => {
    expect(price(99.5)).toBe(60.5);
    expect(price(100)).toBe(61);
    expect(price(150)).toBe(111);
  });

  it('applies night rates (23:00-07:00)', () => {
    const night = calculatePrice(
      { vehicleSlug: 'van', distanceKm: 25.3, durationMinutes: 0, passengers: 2, isReturn: false, time: '23:30' },
      PRICING,
    ).outwardPrice;
    expect(night).toBe(131);
  });

  it('symmetry: the averaged distance of both directions yields one price', () => {
    const avg = (25.3 + 22.9) / 2;
    expect(price(avg)).toBe(20);
  });

  it('doubles for return trips', () => {
    const r = calculatePrice(
      { vehicleSlug: 'sedan', distanceKm: 25.3, durationMinutes: 0, passengers: 2, isReturn: true, time: '12:00' },
      PRICING,
    );
    expect(r.totalPrice).toBe(60);
  });
});
