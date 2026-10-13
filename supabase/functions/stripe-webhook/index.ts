// Stripe webhook: marks invoices processing (ACH initiated) / paid / back to open.
// Configure in Stripe: checkout.session.completed, checkout.session.async_payment_succeeded,
// checkout.session.async_payment_failed.
import Stripe from 'npm:stripe@17.7.0';
import { adminClient } from '../_shared/clients.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!, undefined, cryptoProvider);
  } catch (e) {
    return new Response(`bad signature: ${e}`, { status: 400 });
  }

  const db = adminClient();
  if (event.type.startsWith('checkout.session.')) {
    const s = event.data.object as Stripe.Checkout.Session;
    const ids = (s.metadata?.invoice_ids ?? '').split(',').filter(Boolean);
    if (!ids.length) return new Response('no invoices', { status: 200 });
    const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
    const method = s.payment_method_types?.includes('us_bank_account') && s.payment_status !== 'paid' ? 'ach' : 'stripe';

    if (event.type === 'checkout.session.async_payment_failed') {
      await db.from('invoices').update({ status: 'open' }).in('id', ids);
    } else if (s.payment_status === 'paid') {
      const { data: invs } = await db.from('invoices').select('id, total, status').in('id', ids);
      for (const inv of invs ?? []) {
        if (inv.status === 'paid') continue;
        await db.from('payments').insert({ invoice_id: inv.id, amount: inv.total, method, stripe_payment_intent_id: pi });
        await db.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: method,
          stripe_payment_intent_id: pi }).eq('id', inv.id);
      }
    } else {
      // ACH debit initiated; settles in a few business days
      await db.from('invoices').update({ status: 'processing', stripe_payment_intent_id: pi }).in('id', ids).eq('status', 'open');
    }
  }
  return new Response('ok', { status: 200 });
});
