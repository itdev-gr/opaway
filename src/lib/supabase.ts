import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
	throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Verify a user's current password without disturbing the shared auth
 * session. Uses a throwaway client that does NOT persist a session, so
 * signInWithPassword here doesn't fire the main client's onAuthStateChange
 * cascade (which was hanging the DriverLayout auth overlay on password
 * change — F34) and doesn't rotate the tokens the page is currently using.
 *
 * Returns `null` on success or an `Error` when the current password does
 * not match. Any other failure mode also returns the raw error.
 */
export async function verifyCurrentPassword(email: string, currentPassword: string): Promise<Error | null> {
	const probe = createClient(supabaseUrl!, supabaseAnonKey!, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
	});
	const { error } = await probe.auth.signInWithPassword({ email, password: currentPassword });
	// Signing out the probe client releases the ephemeral tokens immediately.
	try { await probe.auth.signOut(); } catch { /* best-effort */ }
	return error ? (error instanceof Error ? error : new Error(error.message ?? 'verification failed')) : null;
}
