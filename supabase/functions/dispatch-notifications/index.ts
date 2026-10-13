// Database Webhook target for INSERT on public.notifications.
// Sends an Expo push to the recipient; urgent rows (breakdowns) also go out by SMS (Twilio).
// Protect with a shared secret: set NOTIFY_WEBHOOK_SECRET and send it as the
// `x-webhook-secret` header from the Database Webhook.
import { adminClient } from '../_shared/clients.ts';

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('NOTIFY_WEBHOOK_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const payload = await req.json();
  const n = payload.record as { user_id: string; title: string; body: string | null; urgent: boolean; activity_id: number | null };
  const db = adminClient();
  const { data: profile } = await db.from('profiles').select('expo_push_token, phone').eq('id', n.user_id).single();
  const results: Record<string, unknown> = {};

  if (profile?.expo_push_token) {
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: profile.expo_push_token, title: n.title, body: n.body ?? '', priority: n.urgent ? 'high' : 'default',
        sound: 'default', data: { activityId: n.activity_id } }),
    });
    results.push = r.status;
  }

  const sid = Deno.env.get('TWILIO_ACCOUNT_SID'), token = Deno.env.get('TWILIO_AUTH_TOKEN'), from = Deno.env.get('TWILIO_FROM');
  if (n.urgent && profile?.phone && sid && token && from) {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: profile.phone, From: from, Body: `${n.title}${n.body ? ' — ' + n.body : ''}` }),
    });
    results.sms = r.status;
  }
  return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
});
