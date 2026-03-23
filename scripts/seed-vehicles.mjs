/**
 * Seed the `vehicles` collection with 3 default platform vehicles.
 *
 * Usage:
 *   node scripts/seed-vehicles.mjs <path-to-serviceAccountKey.json>
 *   Or set GOOGLE_APPLICATION_CREDENTIALS env var.
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function main() {
	const keyPath = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
	if (!keyPath) {
		console.error('Usage: node scripts/seed-vehicles.mjs <path-to-serviceAccountKey.json>');
		console.error('Or set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON.');
		process.exit(1);
	}

	let app;
	try {
		const keyPathResolved = resolve(process.cwd(), keyPath);
		const serviceAccount = JSON.parse(readFileSync(keyPathResolved, 'utf8'));
		app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
	} catch (e) {
		console.error('Failed to load service account:', e.message);
		process.exit(1);
	}

	const db = admin.firestore();
	const vehiclesRef = db.collection('vehicles');

	const vehicles = [
		{
			slug: 'sedan',
			name: 'Sedan',
			models: 'Mercedes-Benz E-Class, or similar.',
			image: '/car.avif',
			maxPassengers: 3,
			luggagePerPerson: '1 big + 1 small',
			badge: 'BEST VALUE',
			sortOrder: 1,
			active: true,
			ownerId: null,
			ownerType: 'platform',
			createdAt: admin.firestore.FieldValue.serverTimestamp(),
		},
		{
			slug: 'van',
			name: 'Van',
			models: 'Mercedes Vito Tourer, or similar.',
			image: '/mini_van.avif',
			maxPassengers: 8,
			luggagePerPerson: '1 big + 1 small',
			badge: 'MOST POPULAR',
			sortOrder: 2,
			active: true,
			ownerId: null,
			ownerType: 'platform',
			createdAt: admin.firestore.FieldValue.serverTimestamp(),
		},
		{
			slug: 'minibus',
			name: 'Minibus (or two Vans)',
			models: 'Mercedes Sprinter, or similar.',
			image: '/van.avif',
			maxPassengers: 18,
			luggagePerPerson: '1 big + 1 small',
			badge: 'TOP CLASS',
			sortOrder: 3,
			active: true,
			ownerId: null,
			ownerType: 'platform',
			createdAt: admin.firestore.FieldValue.serverTimestamp(),
		},
	];

	let created = 0;
	for (const v of vehicles) {
		// Check if already seeded by slug
		const existing = await vehiclesRef.where('slug', '==', v.slug).limit(1).get();
		if (!existing.empty) {
			console.log(`Skipped "${v.name}" (already exists)`);
			continue;
		}
		await vehiclesRef.add(v);
		console.log(`Created "${v.name}"`);
		created++;
	}

	console.log(`Done. Created: ${created}, Skipped: ${vehicles.length - created}`);
	app.delete();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
