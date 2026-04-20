import { loadGoogleMaps } from './google-maps';

interface AutocompleteOptions {
	country?: string | string[];
	types?: string[];
	onPlaceChanged?: (place: google.maps.places.PlaceResult, input: HTMLInputElement) => void;
}

/**
 * Attach Google Places Autocomplete to an input. Loads the Maps script on demand.
 * Safe no-op if the input is null, the API key is missing, or the API fails to load.
 * Default behaviour on selection: formats the input value as `name, formatted_address`
 * — matches the existing project convention across booking pages.
 */
export async function attachPlacesAutocomplete(
	input: HTMLInputElement | null,
	opts: AutocompleteOptions = {},
): Promise<google.maps.places.Autocomplete | null> {
	if (!input) return null;
	if (input.dataset.placesAttached === '1') return null;

	const maps = await loadGoogleMaps();
	if (!maps?.maps?.places) return null;

	const ac = new maps.maps.places.Autocomplete(input, {
		types: opts.types ?? ['geocode', 'establishment'],
		componentRestrictions: { country: opts.country ?? 'gr' },
	});
	ac.setFields(['formatted_address', 'name', 'geometry']);

	ac.addListener('place_changed', () => {
		const place = ac.getPlace();
		if (opts.onPlaceChanged) {
			opts.onPlaceChanged(place, input);
			return;
		}
		if (place?.name && place?.formatted_address && !place.formatted_address.includes(place.name)) {
			input.value = `${place.name}, ${place.formatted_address}`;
		} else {
			input.value = place?.formatted_address || place?.name || input.value;
		}
	});

	input.dataset.placesAttached = '1';
	return ac;
}
