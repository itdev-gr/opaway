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
