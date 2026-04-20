/**
 * Load the Google Maps JS API exactly once per session.
 * Safe to call from multiple components — the promise is memoized.
 * Resolves to `null` when the API key is missing or the script fails,
 * so callers can gracefully skip autocomplete wiring.
 */

type MapsGlobal = typeof google;

let promise: Promise<MapsGlobal | null> | null = null;

export function loadGoogleMaps(): Promise<MapsGlobal | null> {
	if (promise) return promise;

	promise = new Promise((resolve) => {
		if (typeof window === 'undefined') {
			resolve(null);
			return;
		}

		const key = import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined;
		if (!key) {
			console.warn('[google-maps] PUBLIC_GOOGLE_MAPS_API_KEY is not set; autocomplete disabled');
			resolve(null);
			return;
		}

		const existingGoogle = (window as unknown as { google?: MapsGlobal }).google;
		if (existingGoogle?.maps?.places) {
			resolve(existingGoogle);
			return;
		}

		const alreadyInjected = document.querySelector<HTMLScriptElement>('script[data-opaway-google-maps]');
		if (alreadyInjected) {
			alreadyInjected.addEventListener('load', () => resolve((window as unknown as { google?: MapsGlobal }).google ?? null));
			alreadyInjected.addEventListener('error', () => resolve(null));
			return;
		}

		const script = document.createElement('script');
		script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
		script.async = true;
		script.defer = true;
		script.dataset.opawayGoogleMaps = '1';
		script.addEventListener('load', () => resolve((window as unknown as { google?: MapsGlobal }).google ?? null));
		script.addEventListener('error', () => {
			console.error('[google-maps] script failed to load');
			resolve(null);
		});
		document.head.appendChild(script);
	});

	return promise;
}
