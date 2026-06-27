// Client-side glue between <BookingsToolbar /> and a page's render function.
// Reads the toolbar controls into a BookingFilterState and wires change/quick
// buttons. Kept separate from booking-filters.ts (which stays DOM-free + tested).
import type { BookingFilterState } from './booking-filters';

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const val = (id: string) =>
  (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '';

const setVal = (id: string, v: string) => {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (el) el.value = v;
};

export function getBookingFilterState(): BookingFilterState {
  return {
    status: (val('bk-status') || 'active') as BookingFilterState['status'],
    sort: (val('bk-sort') || 'date_asc') as BookingFilterState['sort'],
    from: val('bk-from') || undefined,
    to: val('bk-to') || undefined,
  };
}

export function wireBookingsToolbar(onChange: () => void): void {
  ['bk-status', 'bk-sort', 'bk-from', 'bk-to'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', onChange);
  });
  document.getElementById('bk-today')?.addEventListener('click', () => {
    const t = todayStr();
    setVal('bk-from', t);
    setVal('bk-to', t);
    onChange();
  });
  document.getElementById('bk-upcoming')?.addEventListener('click', () => {
    setVal('bk-from', todayStr());
    setVal('bk-to', '');
    onChange();
  });
  document.getElementById('bk-clear')?.addEventListener('click', () => {
    setVal('bk-from', '');
    setVal('bk-to', '');
    setVal('bk-status', 'active');
    setVal('bk-sort', 'date_asc');
    onChange();
  });
}
