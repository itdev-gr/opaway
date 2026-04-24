import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const SUPABASE_URL = 'https://wjqfcijisslzqxesbbox.supabase.co';
const SERVICE = process.env.SB_SERVICE_ROLE_KEY;
if (!SERVICE) { console.error('Set SB_SERVICE_ROLE_KEY'); process.exit(1); }

const supa = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const PASSWORD = 'SmokeTest!2026-04-22';

const accounts = [
    { kind: 'admin',    email: 'smoke-admin-2026-04-22@opawey.test',   setup: async (uid) => {
        const { error } = await supa.from('users').upsert({ id: uid, email: 'smoke-admin-2026-04-22@opawey.test', type: 'admin', display_name: 'Smoke Admin' });
        if (error) throw error;
    }},
    { kind: 'user',     email: 'smoke-user-2026-04-22@opawey.test',    setup: async (uid) => {
        const { error } = await supa.from('users').upsert({ id: uid, email: 'smoke-user-2026-04-22@opawey.test', type: 'user', display_name: 'Smoke User' });
        if (error) throw error;
    }},
    { kind: 'hotel',    email: 'smoke-hotel-2026-04-22@opawey.test',   setup: async (uid) => {
        const { error } = await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-hotel-2026-04-22@opawey.test',
            type: 'hotel', status: 'approved', hotel_name: 'Smoke Hotel', display_name: 'Smoke Hotel',
            commission_eur:            10.00,
            commission_transfer_eur:   10.00,
            commission_hourly_eur:      8.00,
            commission_tour_eur:       15.00,
            commission_experience_eur: 12.00,
            discount: 0 });
        if (error) throw error;
    }},
    { kind: 'agency',   email: 'smoke-agency-2026-04-22@opawey.test',  setup: async (uid) => {
        const { error } = await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-agency-2026-04-22@opawey.test',
            type: 'agency', status: 'approved', agency_name: 'Smoke Agency', display_name: 'Smoke Agency',
            discount: 10 });
        if (error) throw error;
    }},
    { kind: 'driver',   email: 'smoke-driver-2026-04-22@opawey.test',  setup: async (uid) => {
        const { error } = await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-driver-2026-04-22@opawey.test',
            type: 'driver', status: 'approved', full_name: 'Smoke Driver', display_name: 'Smoke Driver',
            num_vehicles: '1' });
        if (error) throw error;
    }},
    { kind: 'pending',  email: 'smoke-pending-2026-04-22@opawey.test', setup: async (uid) => {
        const { error } = await supa.from('partners').upsert({ id: uid, uid: uid, email: 'smoke-pending-2026-04-22@opawey.test',
            type: 'hotel', status: 'pending', hotel_name: 'Pending Hotel', display_name: 'Pending Hotel' });
        if (error) throw error;
    }},
];

const out = { createdAt: new Date().toISOString(), password: PASSWORD, accounts: {} };

for (const a of accounts) {
    let userId;
    const { data: created, error: createErr } = await supa.auth.admin.createUser({
        email: a.email, password: PASSWORD, email_confirm: true,
    });
    if (createErr && /already.*registered|already.*exists|duplicate/i.test(createErr.message || '')) {
        // Look up by listing all users (paginated).
        let page = 1; let found = null;
        while (!found) {
            const { data: list, error: listErr } = await supa.auth.admin.listUsers({ page, perPage: 1000 });
            if (listErr) throw listErr;
            found = list?.users?.find(u => u.email === a.email);
            if (!list?.users?.length || list.users.length < 1000) break;
            page++;
        }
        if (!found) { console.error(`❌ ${a.kind}: could not locate existing user ${a.email}`); continue; }
        userId = found.id;
        console.log(`↺ ${a.kind} exists (${userId}) — running setup`);
    } else if (createErr) {
        console.error(`❌ ${a.kind}: ${createErr.message}`);
        continue;
    } else {
        userId = created.user.id;
        console.log(`✓ ${a.kind} created (${userId})`);
    }
    try { await a.setup(userId); }
    catch (e) { console.error(`❌ ${a.kind} setup: ${e.message}`); continue; }
    out.accounts[a.kind] = { email: a.email, id: userId };
}

writeFileSync('.test-accounts.json', JSON.stringify(out, null, 2));
console.log('\nWritten to .test-accounts.json');
