// A round-trip transfer is stored as ONE row in `transfers` with
// `return_date` / `return_time` set; the return route runs in reverse (to → from).
// Returns the synthetic return leg for calendar views, or null for one-way rows.
export function transferReturnLeg(row: any): { date: string; time: string; from: string; to: string } | null {
	const rd = String(row?.return_date ?? '').trim();
	if (!rd) return null;
	return {
		date: rd,
		time: String(row?.return_time ?? '').trim(),
		from: row?.to || row?.dropoff || '',
		to: row?.from || row?.pickup || '',
	};
}
