// Pay / Pay-all: creates a Stripe Checkout Session for one or more open invoices.
// ACH (us_bank_account) is offered first — card fees (~3%) erode parts-at-cost.
// With Stripe Connect, funds route to the issuing provider's connected account and
// the platform fee (if the revenue model uses one) comes off automatically.
import Stripe from 'npm:stripe@17.7.0';
import { adminClient, corsHeaders, json, userClient } from '../_shared/clients.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { invoiceIds, returnUrl } = await req.json() as { invoiceIds: string[]; returnUrl: string };
    if (!invoiceIds?.length) return json({ error: 'no invoices' }, 400);

    // RLS: the caller must be able to see every invoice
    const caller = userClient(req);
    const { data: invoices, error } = await caller.from('invoices')
      .select('id, number, total, status, fleet_org_id, issuer_org_id, platform_fee_amount, memo')
      .in('id', invoiceIds);
    if (error) return json({ error: error.message }, 400);
    if (!invoices || invoices.length !== invoiceIds.length) return json({ error: 'invoice not found' }, 404);
    if (invoices.some((i) => i.status !== 'open')) return json({ error: 'only open invoices can be paid' }, 400);
    const fleets = new Set(invoices.map((i) => i.fleet_org_id));
    const issuers = new Set(invoices.map((i) => i.issuer_org_id));
    if (fleets.size !== 1 || issuers.size !== 1) {
      return json({ error: 'Pay invoices from one provider at a time.' }, 400);
    }

    const admin = adminClient();
    const fleetId = invoices[0].fleet_org_id;
    const { data: fleet } = await admin.from('organizations').select('id, name, email, stripe_customer_id').eq('id', fleetId).single();
    const { data: issuer } = await admin.from('organizations').select('stripe_account_id').eq('id', invoices[0].issuer_org_id).single();

    let customer = fleet!.stripe_customer_id as string | null;
    if (!customer) {
      const c = await stripe.customers.create({ name: fleet!.name, email: fleet!.email ?? undefined, metadata: { org_id: fleetId } });
      customer = c.id;
      await admin.from('organizations').update({ stripe_customer_id: customer }).eq('id', fleetId);
    }

    const cents = (n: number) => Math.round(Number(n) * 100);
    const fee = invoices.reduce((s, i) => s + cents(i.platform_fee_amount), 0);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer,
      payment_method_types: ['us_bank_account', 'card'],
      line_items: invoices.map((i) => ({
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: cents(i.total), product_data: { name: `${i.number} · ${i.memo ?? ''}` } },
      })),
      payment_intent_data: {
        metadata: { invoice_ids: invoiceIds.join(',') },
        ...(issuer?.stripe_account_id
          ? { transfer_data: { destination: issuer.stripe_account_id }, ...(fee > 0 ? { application_fee_amount: fee } : {}) }
          : {}),
      },
      metadata: { invoice_ids: invoiceIds.join(',') },
      success_url: `${returnUrl}?paid=1`,
      cancel_url: `${returnUrl}?cancelled=1`,
    });

    await admin.from('invoices').update({ stripe_checkout_session_id: session.id }).in('id', invoiceIds);
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
