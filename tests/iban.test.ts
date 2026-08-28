import { describe, it, expect } from 'vitest';
import { normalizeIban, formatIban, validateIban, maskIban } from '../src/lib/iban';

// Published specimen IBANs (ECBS / national bank examples).
const GR_VALID = 'GR1601101250000000012300695';
const DE_VALID = 'DE89370400440532013000';
const GB_VALID = 'GB29NWBK60161331926819';

describe('normalizeIban / formatIban', () => {
  it('strips spaces and punctuation and uppercases', () => {
    expect(normalizeIban(' gr16 0110-1250 0000 0001 2300 695 ')).toBe(GR_VALID);
  });

  it('formats in groups of four', () => {
    expect(formatIban(GR_VALID)).toBe('GR16 0110 1250 0000 0001 2300 695');
  });

  it('round-trips', () => {
    expect(normalizeIban(formatIban(GR_VALID))).toBe(GR_VALID);
  });

  it('handles empty input', () => {
    expect(normalizeIban('')).toBe('');
    expect(formatIban('')).toBe('');
  });
});

describe('validateIban', () => {
  it('accepts valid IBANs from several countries', () => {
    for (const iban of [GR_VALID, DE_VALID, GB_VALID]) {
      expect(validateIban(iban), iban).toEqual({ ok: true, iban });
    }
  });

  it('accepts a human-typed IBAN with spaces and lowercase', () => {
    expect(validateIban('gr16 0110 1250 0000 0001 2300 695')).toEqual({ ok: true, iban: GR_VALID });
  });

  it('rejects an empty value', () => {
    expect(validateIban('')).toMatchObject({ ok: false });
    expect(validateIban('   ')).toMatchObject({ ok: false });
  });

  it('rejects a wrong shape', () => {
    expect(validateIban('1234567890')).toMatchObject({ ok: false });
    expect(validateIban('GRXX0110125')).toMatchObject({ ok: false });
  });

  it('rejects a wrong length for a known country', () => {
    const r = validateIban('GR160110125000000001230069');   // one short
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/27 characters/);
  });

  it('catches a single-digit typo via the mod-97 checksum', () => {
    const typo = GR_VALID.slice(0, 10) + (GR_VALID[10] === '0' ? '1' : '0') + GR_VALID.slice(11);
    const r = validateIban(typo);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/checksum/);
  });

  it('catches transposed characters', () => {
    // Swap the first adjacent pair that actually differs — swapping equal
    // characters is a no-op and would prove nothing.
    const i = [...DE_VALID].findIndex((c, n) => n > 3 && c !== DE_VALID[n + 1]);
    const swapped = DE_VALID.slice(0, i) + DE_VALID[i + 1] + DE_VALID[i] + DE_VALID.slice(i + 2);
    expect(swapped).not.toBe(DE_VALID);
    expect(validateIban(swapped).ok).toBe(false);
  });

  it('accepts an unlisted country that passes shape + checksum', () => {
    // Length table has no entry for this prefix; the mod-97 check still governs.
    expect(validateIban(GB_VALID).ok).toBe(true);
  });
});

describe('maskIban', () => {
  it('shows only the country and last four', () => {
    expect(maskIban(GR_VALID)).toBe('GR•••• 0695');
  });

  it('is empty for no IBAN', () => {
    expect(maskIban('')).toBe('');
  });
});
