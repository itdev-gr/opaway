import { supabase } from './supabase';

/**
 * Creates or updates the user profile in Supabase (table `users`).
 * Use after every successful sign-in (login or register, email or Google)
 * so you can manage clients from the database.
 * - New users: sets id, email, display_name, provider, type ('user'), created_at, last_login_at.
 * - Existing users: updates last_login_at.
 */
export async function ensureUserProfile(
	user: { id: string; email?: string | null },
	displayName?: string | null,
	provider: string = 'email'
): Promise<void> {
	const { data: existing } = await supabase
		.from('users')
		.select('id, type')
		.eq('id', user.id)
		.maybeSingle();

	if (!existing) {
		await supabase.from('users').insert({
			id: user.id,
			email: user.email ?? '',
			display_name: displayName?.trim() || null,
			provider,
			type: 'user',
			last_login_at: new Date().toISOString(),
		});
	} else {
		await supabase
			.from('users')
			.update({
				last_login_at: new Date().toISOString(),
				...(displayName ? { display_name: displayName.trim() } : {}),
			})
			.eq('id', user.id);
	}
}
