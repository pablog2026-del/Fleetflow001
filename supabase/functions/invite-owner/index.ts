// Door 1, step 5: Admin sends the owner an invite link. The owner sets a password
// and lands in a fully populated fleet. The pending invitation row is turned into
// a membership by the on_auth_user_created trigger (or directly here if the user exists).
import { adminClient, corsHeaders, json, userClient } from '../_shared/clients.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = userClient(req);
    const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin');
    if (adminErr || !isAdmin) return json({ error: 'admin only' }, 403);
    const { data: { user: me } } = await caller.auth.getUser();

    const { orgId, email, fullName, redirectTo } = await req.json();
    if (!orgId || !email) return json({ error: 'orgId and email are required' }, 400);

    const admin = adminClient();
    const { data: org } = await admin.from('organizations').select('id, name, type').eq('id', orgId).single();
    if (!org || org.type !== 'fleet') return json({ error: 'unknown fleet' }, 404);

    const { data: existing } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (existing) {
      await admin.from('memberships').upsert({ user_id: existing.id, org_id: orgId, role: 'owner' });
      await admin.from('invitations').insert({ org_id: orgId, email, role: 'owner', full_name: fullName,
        invited_by: me?.id, accepted_at: new Date().toISOString() });
      return json({ ok: true, existingUser: true });
    }

    const { error: invRowErr } = await admin.from('invitations')
      .insert({ org_id: orgId, email, role: 'owner', full_name: fullName, invited_by: me?.id });
    if (invRowErr) return json({ error: invRowErr.message }, 400);

    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo ?? Deno.env.get('APP_URL') + '/auth/callback',
      data: { full_name: fullName ?? '', org_name: org.name },
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
