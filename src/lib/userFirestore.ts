import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

const USERS_COLLECTION = 'users';

/**
 * Creates or updates the user document in Firestore (collection `users`).
 * Use after every successful sign-in (login or register, email or Google)
 * so you can manage clients from the database.
 * - New users: sets uid, email, displayName, provider, type ('user'), createdAt, lastLoginAt.
 * - Existing users: updates lastLoginAt; adds type 'user' if missing (migration).
 */
export async function ensureUserInFirestore(user: User, displayName?: string): Promise<void> {
	const userRef = doc(db, USERS_COLLECTION, user.uid);
	const snapshot = await getDoc(userRef);
	const isNewUser = !snapshot.exists();
	const existingData = snapshot.exists() ? snapshot.data() : null;

	const provider = user.providerId === 'google.com' ? 'google' : 'email';
	const payload: Record<string, unknown> = {
		uid: user.uid,
		email: user.email ?? '',
		displayName: displayName?.trim() || user.displayName || null,
		provider,
		lastLoginAt: serverTimestamp(),
	};
	if (isNewUser) {
		payload.createdAt = serverTimestamp();
		payload.type = 'user';
	} else if (existingData && existingData.type === undefined) {
		// Migrate existing users: set type if missing
		payload.type = 'user';
	}

	await setDoc(userRef, payload, { merge: true });
}
