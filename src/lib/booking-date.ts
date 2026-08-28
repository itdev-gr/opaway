/**
 * Booking-date rules. The business operates in Greece, so "today" is always
 * computed in Europe/Athens — on the client AND the server (Vercel runs UTC,
 * which would otherwise be up to ~3h lenient around midnight).
 *
 * Booking dates are plain `YYYY-MM-DD` strings end-to-end, so lexicographic
 * comparison is correct and no Date parsing (with its timezone pitfalls) is
 * needed.
 */

/** Today's date as `YYYY-MM-DD` in Europe/Athens. */
export function todayAthens(): string {
	// en-CA locale formats as YYYY-MM-DD.
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
}

/** True when `date` (YYYY-MM-DD) is before today in Athens. Empty/garbage → true (blocked). */
export function isPastBookingDate(date: string): boolean {
	return date < todayAthens();
}

/** Set `min` = Athens-today on the given `<input type="date">` ids (missing ids are skipped). */
export function applyMinBookingDate(...ids: string[]): void {
	const min = todayAthens();
	for (const id of ids) {
		const el = document.getElementById(id) as HTMLInputElement | null;
		if (el) el.min = min;
	}
}

/**
 * Convert a timestamp (ISO string from Postgres `timestamptz`) to its calendar
 * date in Europe/Athens as `YYYY-MM-DD`. Returns '' for null/empty/invalid.
 *
 * Needed because a payment captured at 00:30 Athens is 21:30 UTC the previous
 * day — bucketing revenue on the raw UTC instant would file it in the wrong
 * month for the business.
 */
export function toAthensDate(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (isNaN(d.getTime())) return '';
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(d);
}
