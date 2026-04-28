/**
 * Browser-agnostic time picker. Replaces `<input type="time">` (which fails
 * to render on some Linux Chromium builds and certain corporate browsers)
 * with two `<select>` elements (HH 00–23, MM in 5-minute increments).
 *
 * Render the markup with `renderTimePickerHTML(name)` and read back the
 * combined "HH:MM" string with `readTimePickerValue(name)`.
 *
 * Pass an optional default value as "HH:MM" to pre-select.
 */

const HOURS: string[] = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES: string[] = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

export interface TimePickerOptions {
  defaultValue?: string;     // "HH:MM"
  required?: boolean;
  selectClass?: string;      // tailwind for each <select>
}

const escAttr = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderTimePickerHTML(name: string, opts: TimePickerOptions = {}): string {
  const [defH, defM] = (opts.defaultValue ?? '').split(':');
  const cls = opts.selectClass ?? 'flex-1 px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-[#0C6B95]/20 focus:border-[#0C6B95]';
  const required = opts.required ? ' required' : '';

  const hOptions = HOURS.map(h => `<option value="${h}"${h === defH ? ' selected' : ''}>${h}</option>`).join('');
  const mOptions = MINUTES.map(m => `<option value="${m}"${m === defM ? ' selected' : ''}>${m}</option>`).join('');

  return `
    <div class="time-picker flex items-center gap-2" data-time-picker="${escAttr(name)}">
      <select id="${escAttr(name)}-hh" class="${cls}"${required}>
        <option value="" disabled${defH ? '' : ' selected'}>HH</option>
        ${hOptions}
      </select>
      <span class="text-neutral-400">:</span>
      <select id="${escAttr(name)}-mm" class="${cls}"${required}>
        <option value="" disabled${defM ? '' : ' selected'}>MM</option>
        ${mOptions}
      </select>
    </div>`;
}

/** Reads the picker into an "HH:MM" string. Returns "" if either dropdown is empty. */
export function readTimePickerValue(name: string): string {
  const hh = (document.getElementById(`${name}-hh`) as HTMLSelectElement | null)?.value ?? '';
  const mm = (document.getElementById(`${name}-mm`) as HTMLSelectElement | null)?.value ?? '';
  if (!hh || !mm) return '';
  return `${hh}:${mm}`;
}

/** Convenience for setting both dropdowns programmatically. */
export function setTimePickerValue(name: string, value: string): void {
  const [h, m] = (value ?? '').split(':');
  const hSel = document.getElementById(`${name}-hh`) as HTMLSelectElement | null;
  const mSel = document.getElementById(`${name}-mm`) as HTMLSelectElement | null;
  if (hSel && h) hSel.value = h;
  if (mSel && m) mSel.value = m;
}
