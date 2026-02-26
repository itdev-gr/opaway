import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

function getFirebaseConfig() {
	const apiKey = import.meta.env.PUBLIC_FIREBASE_API_KEY;
	const authDomain = import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN;
	const projectId = import.meta.env.PUBLIC_FIREBASE_PROJECT_ID;
	const storageBucket = import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET;
	const messagingSenderId = import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
	const appId = import.meta.env.PUBLIC_FIREBASE_APP_ID;
	const required = [
		['PUBLIC_FIREBASE_API_KEY', apiKey],
		['PUBLIC_FIREBASE_AUTH_DOMAIN', authDomain],
		['PUBLIC_FIREBASE_PROJECT_ID', projectId],
		['PUBLIC_FIREBASE_STORAGE_BUCKET', storageBucket],
		['PUBLIC_FIREBASE_MESSAGING_SENDER_ID', messagingSenderId],
		['PUBLIC_FIREBASE_APP_ID', appId],
	] as const;
	for (const [key, value] of required) {
		if (typeof value !== 'string' || value.trim() === '') {
			throw new Error(
				`Missing Firebase env: ${key}. Set PUBLIC_FIREBASE_* in .env or Vercel.`
			);
		}
	}
	return {
		apiKey,
		authDomain,
		projectId,
		storageBucket,
		messagingSenderId,
		appId,
	};
}

const firebaseConfig = getFirebaseConfig();
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
