/**
 * Inline form-error helpers. Replace any `alert(...)` call for validation
 * or API-failure messaging with calls to these functions.
 *
 * Per-field errors:
 *   <input id="tf-from" … />
 *   <p data-error-for="tf-from" class="text-sm text-red-500 mt-1.5 hidden"></p>
 *
 * Form-level errors:
 *   <div data-form-error class="hidden mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"></div>
 *
 * Call `clearFormErrors(scope)` at the start of each submit handler, then
 * call `showFieldError` / `showFormError` as needed.
 */

const FIELD_ERROR_CLASSES = ['border-red-400', 'focus:border-red-400', 'focus:ring-red-200'];

function findErrorFor(input: HTMLElement): HTMLElement | null {
	const id = input.id;
	if (!id) return null;
	return document.querySelector<HTMLElement>(`[data-error-for="${id}"]`);
}

export function showFieldError(input: HTMLElement | null, message: string): void {
	if (!input) return;
	FIELD_ERROR_CLASSES.forEach((c) => input.classList.add(c));
	input.setAttribute('aria-invalid', 'true');
	const holder = findErrorFor(input);
	if (holder) {
		holder.textContent = message;
		holder.classList.remove('hidden');
	}
}

export function clearFieldError(input: HTMLElement | null): void {
	if (!input) return;
	FIELD_ERROR_CLASSES.forEach((c) => input.classList.remove(c));
	input.removeAttribute('aria-invalid');
	const holder = findErrorFor(input);
	if (holder) {
		holder.textContent = '';
		holder.classList.add('hidden');
	}
}

export function showFormError(scope: HTMLElement | null, message: string): void {
	if (!scope) return;
	const el = scope.querySelector<HTMLElement>('[data-form-error]');
	if (!el) {
		console.warn('[form-errors] no [data-form-error] element inside scope');
		return;
	}
	el.textContent = message;
	el.classList.remove('hidden');
	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function clearFormErrors(scope: HTMLElement | null): void {
	if (!scope) return;
	scope.querySelectorAll<HTMLElement>('[data-form-error]').forEach((el) => {
		el.textContent = '';
		el.classList.add('hidden');
	});
	scope.querySelectorAll<HTMLElement>('[data-error-for]').forEach((el) => {
		el.textContent = '';
		el.classList.add('hidden');
	});
	scope.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((input) => {
		FIELD_ERROR_CLASSES.forEach((c) => input.classList.remove(c));
		input.removeAttribute('aria-invalid');
	});
}

/**
 * Wire input/change listeners so field errors auto-clear once the user
 * starts fixing them. Call once per required input after the form renders.
 */
export function wireAutoClear(inputs: (HTMLElement | null)[]): void {
	inputs.forEach((input) => {
		if (!input) return;
		const handler = () => clearFieldError(input);
		input.addEventListener('input', handler);
		input.addEventListener('change', handler);
	});
}
