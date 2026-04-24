// src/lib/luggage-counters.ts
//
// Wires the `-` / `+` buttons inside a `<LuggageCounters rootId="…" />`
// instance, and reads back the two integer counts (small + big). The
// markup lives in src/components/LuggageCounters.astro — this module
// is purely DOM. Safe to call multiple times on the same page when
// there are multiple instances (each with a unique rootId).

export interface LuggageCounterOptions {
    /** Upper bound per bag type. Default 20 (generous — minibus capacity). */
    max?: number;
}

export interface LuggageCounts {
    small: number;
    big: number;
}

function clampInt(n: number, lo: number, hi: number): number {
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

function resolveRoot(rootOrId: string | HTMLElement): HTMLElement | null {
    if (typeof rootOrId === 'string') return document.getElementById(rootOrId);
    return rootOrId;
}

/**
 * Wire the -/+ buttons inside a LuggageCounters widget. Each bag-type
 * block inside `root` is expected to look like:
 *
 *   <div data-luggage="small">
 *     <button data-action="minus">-</button>
 *     <span data-value>0</span>
 *     <button data-action="plus">+</button>
 *   </div>
 *
 * After this call, clicking minus/plus updates the visible count and
 * toggles disabled state at 0 / max.
 */
export function initLuggageCounters(rootOrId: string | HTMLElement, opts: LuggageCounterOptions = {}): void {
    const root = resolveRoot(rootOrId);
    if (!root) return;
    const max = opts.max ?? 20;

    root.querySelectorAll<HTMLElement>('[data-luggage]').forEach(group => {
        const minus = group.querySelector<HTMLButtonElement>('[data-action="minus"]');
        const plus  = group.querySelector<HTMLButtonElement>('[data-action="plus"]');
        const value = group.querySelector<HTMLElement>('[data-value]');
        if (!minus || !plus || !value) return;

        let count = clampInt(Number(value.textContent?.trim() ?? '0'), 0, max);

        const render = () => {
            value.textContent = String(count);
            minus.disabled = count <= 0;
            plus.disabled = count >= max;
            minus.setAttribute('aria-disabled', minus.disabled ? 'true' : 'false');
            plus.setAttribute('aria-disabled', plus.disabled ? 'true' : 'false');
        };

        minus.addEventListener('click', (e) => { e.preventDefault(); if (count > 0)   { count -= 1; render(); } });
        plus.addEventListener('click',  (e) => { e.preventDefault(); if (count < max) { count += 1; render(); } });

        render();
    });
}

/** Read the current small/big counts from a LuggageCounters widget. */
export function getLuggageCounts(rootOrId: string | HTMLElement): LuggageCounts {
    const root = resolveRoot(rootOrId);
    if (!root) return { small: 0, big: 0 };
    const read = (kind: 'small' | 'big'): number => {
        const el = root.querySelector<HTMLElement>(`[data-luggage="${kind}"] [data-value]`);
        const n = Number((el?.textContent ?? '0').trim());
        return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    };
    return { small: read('small'), big: read('big') };
}

/** Write counts back (e.g. restoring from URL params on a back-nav). */
export function setLuggageCounts(rootOrId: string | HTMLElement, counts: Partial<LuggageCounts>): void {
    const root = resolveRoot(rootOrId);
    if (!root) return;
    const write = (kind: 'small' | 'big', n: number) => {
        const el = root.querySelector<HTMLElement>(`[data-luggage="${kind}"] [data-value]`);
        if (el) el.textContent = String(clampInt(n, 0, 99));
    };
    if (counts.small != null) write('small', counts.small);
    if (counts.big != null)   write('big',   counts.big);
    // Note: call setLuggageCounts BEFORE initLuggageCounters so the init
    // reads the restored values and sets the correct disabled state. This
    // function only updates the visible number; it does NOT re-attach
    // handlers.
}
