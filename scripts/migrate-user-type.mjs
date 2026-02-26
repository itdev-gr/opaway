/**
 * One-time migration: add field "type": "user" to all existing user documents
 * that don't have a "type" field (Firestore collection "users").
 *
 * Prerequisites:
 *   1. npm install firebase-admin
 *   2. Download a service account key from Firebase Console:
 *      Project settings → Service accounts → Generate new private key
 *   3. Set env: GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
 *      Or run: node scripts/migrate-user-type.mjs /path/to/serviceAccountKey.json
 *
 * Run from project root: node scripts/migrate-user-type.mjs [path-to-service-account.json]
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
	const keyPath = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
	if (!keyPath) {
		console.error('Usage: node scripts/migrate-user-type.mjs <path-to-serviceAccountKey.json>');
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
	const usersRef = db.collection('users');
	const snapshot = await usersRef.get();
	let updated = 0;
	let skipped = 0;

	for (const docSnap of snapshot.docs) {
		const data = docSnap.data();
		if (data.type !== undefined) {
			skipped++;
			continue;
		}
		await docSnap.ref.update({ type: 'user' });
		updated++;
		console.log('Updated', docSnap.id, '-> type: "user"');
	}

	console.log('Done. Updated:', updated, 'Skipped (already had type):', skipped);
	app.delete();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
