/**
 * Driver dropdown helpers for admin assignment UIs.
 *
 * - `fetchApprovedDrivers()` queries the `partners` table for approved drivers
 *   (`type='driver'`, `status='approved'`) and caches the in-flight promise per
 *   page load.
 * - `renderDriverOptionsHTML()` returns the <option> string for a <select>.
 * - `buildAssignmentUpdate()` returns the supabase update payload for an
 *   admin-side assignment, with two important guarantees:
 *     1. `ride_status` only moves forward. `'new' → 'assigned'` on assign;
 *        `'assigned' → 'new'` on unassign. Advanced statuses (`pickup`,
 *        `onboard`, `completed`, `cancelled`) are left untouched so a re-pick
 *        of the dropdown can't roll back an in-progress trip.
 *     2. Audit columns `driver_assigned_at` / `driver_assigned_by` are written
 *        on every assignment change.
 * - `handleDriverAssignmentChange()` is the canonical change-handler used by
 *   the three admin pages (transfers, tours, experiences). Each page wires its
 *   `<select.driver-select>` change events through this helper to share write
 *   semantics, error handling, success feedback, and the in-row `ride_status`
 *   sync.
 * - `flashSelectFeedback()` briefly highlights a <select> green/red so the
 *   admin gets visible confirmation a save succeeded or failed.
 */
import { supabase } from './supabase';

export interface DriverOption {
  id: string;        // partners.id (= auth.users.id)
  fullName: string;  // partners.full_name
}

let cachedPromise: Promise<DriverOption[]> | null = null;

export function fetchApprovedDrivers(): Promise<DriverOption[]> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    const { data, error } = await supabase
      .from('partners')
      .select('id, full_name')
      .eq('type', 'driver')
      .eq('status', 'approved')
      .order('full_name', { ascending: true });
    if (error) {
      console.error('fetchApprovedDrivers failed:', error);
      return [];
    }
    return (data ?? []).map((d: any) => ({
      id: String(d.id ?? ''),
      fullName: String(d.full_name ?? '').trim() || 'Unnamed driver',
    }));
  })();
  return cachedPromise;
}

const escAttr = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderDriverOptionsHTML(
  drivers: DriverOption[],
  currentUid: string,
): string {
  const safeCurrent = currentUid || '';
  const unassignedSelected = safeCurrent === '' ? ' selected' : '';
  const head = `<option value=""${unassignedSelected}>Unassigned</option>`;
  const body = drivers.map(d => {
    const sel = d.id === safeCurrent ? ' selected' : '';
    return `<option value="${escAttr(d.id)}"${sel}>${escAttr(d.fullName)}</option>`;
  }).join('');
  return head + body;
}

/* ─────────── assignment write logic ─────────── */

export interface AssignmentInput {
  newDriverUid: string;     // empty string = unassign
  newDriverName: string;    // empty string when unassigning
  currentRideStatus: string;
  adminUserId: string;      // for audit
}

export interface AssignmentUpdate {
  driver_uid: string;
  driver: string;
  ride_status?: string;     // present only when forward-transitioning
  driver_assigned_at: string | null;
  driver_assigned_by: string | null;
}

export function buildAssignmentUpdate(input: AssignmentInput): AssignmentUpdate {
  const isAssigning = !!input.newDriverUid;
  const status = String(input.currentRideStatus || 'new');

  // ride_status: only forward transitions. `pickup`, `onboard`, `completed`,
  // `cancelled` stay put — re-picking the dropdown won't regress an in-flight
  // trip back to 'assigned'.
  let rideStatusUpdate: { ride_status?: string } = {};
  if (isAssigning && status === 'new') rideStatusUpdate = { ride_status: 'assigned' };
  if (!isAssigning && status === 'assigned') rideStatusUpdate = { ride_status: 'new' };

  return isAssigning
    ? {
        driver_uid: input.newDriverUid,
        driver: input.newDriverName,
        ...rideStatusUpdate,
        driver_assigned_at: new Date().toISOString(),
        driver_assigned_by: input.adminUserId || null,
      }
    : {
        driver_uid: '',
        driver: '',
        ...rideStatusUpdate,
        driver_assigned_at: null,
        driver_assigned_by: null,
      };
}

/* ─────────── visual feedback ─────────── */

const FLASH_OK = ['ring-2', 'ring-emerald-400'];
const FLASH_ERR = ['ring-2', 'ring-red-400'];

export function flashSelectFeedback(el: HTMLSelectElement, status: 'ok' | 'error'): void {
  const cls = status === 'ok' ? FLASH_OK : FLASH_ERR;
  el.classList.add(...cls);
  setTimeout(() => el.classList.remove(...cls), 1500);
}

/* ─────────── shared change handler ─────────── */

export interface HandleAssignmentArgs {
  selectEl: HTMLSelectElement;
  table: 'transfers' | 'tours' | 'experiences';
  drivers: DriverOption[];
  rowsById: Map<string, any>;
  applyRideStatusColor?: (s: HTMLSelectElement) => void;
  reload: () => Promise<void>;
}

export async function handleDriverAssignmentChange(args: HandleAssignmentArgs): Promise<void> {
  const { selectEl, table, drivers, rowsById, applyRideStatusColor, reload } = args;
  const docId = selectEl.dataset.id!;
  const newDriverUid = selectEl.value;
  const newDriverName = newDriverUid
    ? (drivers.find(d => d.id === newDriverUid)?.fullName ?? '')
    : '';

  const row = rowsById.get(docId);
  const currentRideStatus = String(row?.ride_status ?? 'new');

  const { data: { user } } = await supabase.auth.getUser();
  const adminUserId = user?.id ?? '';

  const update = buildAssignmentUpdate({
    newDriverUid,
    newDriverName,
    currentRideStatus,
    adminUserId,
  });

  const { error } = await supabase.from(table).update(update).eq('id', docId);
  if (error) {
    console.error(`${table} driver assignment failed:`, error);
    flashSelectFeedback(selectEl, 'error');
    alert(`Save failed: [${error.code ?? 'unknown'}] ${error.message}`);
    await reload();
    return;
  }

  // Sync the local row cache so the reservation modal and any in-page consumers
  // see the new state without a full refetch.
  if (row) {
    row.driver_uid = update.driver_uid;
    row.driver = update.driver;
    if (update.ride_status !== undefined) row.ride_status = update.ride_status;
    row.driver_assigned_at = update.driver_assigned_at;
    row.driver_assigned_by = update.driver_assigned_by;
  }

  // Sync the in-row ride_status select if the status moved.
  if (update.ride_status !== undefined) {
    const tr = selectEl.closest('tr');
    const rideStatusSel = tr?.querySelector('.ride-status-select') as HTMLSelectElement | null;
    if (rideStatusSel && rideStatusSel.value !== update.ride_status) {
      rideStatusSel.value = update.ride_status;
      applyRideStatusColor?.(rideStatusSel);
    }
  }

  flashSelectFeedback(selectEl, 'ok');
}
