// IBAN helpers for affiliate payout details.
// Pure — no supabase import, so it is unit-testable without env vars.
//
// Validation is the ISO 13616 / ISO 7064 mod-97 check: rearrange, letters to
// digits, remainder must be 1. That catches typos a shape check would miss.

/** Uppercase, no spaces or punctuation — the form we store. */
export function normalizeIban(input: string): string {
  return (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Groups of four, the form people read and compare. */
export function formatIban(input: string): string {
  return normalizeIban(input).replace(/(.{4})/g, '$1 ').trim();
}

/** Length per country, where we know it. Unlisted countries fall back to the shape check. */
const IBAN_LENGTHS: Record<string, number> = {
  GR: 27, AL: 28, AD: 24, AT: 20, AZ: 28, BH: 22, BE: 16, BA: 20, BR: 29, BG: 22,
  CR: 22, HR: 21, CY: 28, CZ: 24, DK: 18, DO: 28, EE: 20, FO: 18, FI: 18, FR: 27,
  GE: 22, DE: 22, GI: 23, GL: 18, GT: 28, HU: 28, IS: 26, IE: 22, IL: 23, IT: 27,
  JO: 30, KZ: 20, XK: 20, KW: 30, LV: 21, LB: 28, LI: 21, LT: 20, LU: 20, MT: 31,
  MR: 27, MU: 30, MD: 24, MC: 27, ME: 22, NL: 18, MK: 19, NO: 15, PK: 24, PS: 29,
  PL: 28, PT: 25, QA: 29, RO: 24, SM: 27, SA: 24, RS: 22, SK: 24, SI: 19, ES: 24,
  SE: 24, CH: 21, TN: 24, TR: 26, AE: 23, GB: 22, VA: 22,
};

/** ISO 7064 mod-97-10 over a very long number, computed in chunks. */
function mod97(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(String(remainder) + digits.slice(i, i + 7)) % 97;
  }
  return remainder;
}

export type IbanCheck = { ok: true; iban: string } | { ok: false; error: string };

/**
 * Validate an IBAN. Returns the normalized value, or a message safe to show
 * in the UI. An empty string is rejected here — callers decide whether
 * "no IBAN yet" is allowed.
 */
export function validateIban(input: string): IbanCheck {
  const iban = normalizeIban(input);
  if (!iban) return { ok: false, error: 'Enter an IBAN.' };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return { ok: false, error: 'That does not look like an IBAN (two letters, two digits, then the account number).' };
  }

  const country = iban.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (expected && iban.length !== expected) {
    return { ok: false, error: `A ${country} IBAN has ${expected} characters — this one has ${iban.length}.` };
  }

  // Move the first four characters to the end, then map A→10 … Z→35.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  if (mod97(digits) !== 1) {
    return { ok: false, error: 'This IBAN fails its checksum — check for a typo.' };
  }

  return { ok: true, iban };
}

/** Last four characters only, for places that should not show the whole thing. */
export function maskIban(input: string): string {
  const iban = normalizeIban(input);
  if (!iban) return '';
  return `${iban.slice(0, 2)}•••• ${iban.slice(-4)}`;
}
