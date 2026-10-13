import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, KV, Loading, Note, Pill, Screen, Section, s } from '../../components/ui';
import { ask, say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { dateLabel, errorMessage, money } from '../../lib/format';
import { payInvoices } from '../../lib/pay';
import { invoiceState } from '../../lib/schedule';
import { must, rpc, supabase } from '../../lib/supabase';
import { C } from '../../lib/theme';
import type { Invoice, InvoiceLine } from '../../lib/types';
import { useData } from '../../lib/useData';

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useData(async () => {
    const i = must(await supabase.from('invoices').select('*').eq('id', id).single()) as Invoice;
    const [lines, issuer, fleet] = await Promise.all([
      supabase.from('invoice_lines').select('*').eq('invoice_id', id).order('position').then(must),
      supabase.from('organizations').select('name').eq('id', i.issuer_org_id).maybeSingle().then(must),
      supabase.from('organizations').select('name, payment_terms_days').eq('id', i.fleet_org_id).single().then(must),
    ]);
    return { i, lines: lines as InvoiceLine[], issuer: (issuer as { name: string } | null)?.name ?? 'Provider',
      fleet: fleet as { name: string; payment_terms_days: number } };
  }, [id]);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const { i, lines, issuer, fleet } = data;
  const st = invoiceState(i);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); reload(); } catch (e) { say('Something went wrong', errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Screen onRefresh={reload}>
      <View style={{ padding: 16, gap: 4 }}>
        <Pill label={st.label} tone={st.tone} />
        <Text style={s.h1}>Invoice {i.number}</Text>
        <Text style={{ color: C.soft }}>{issuer} → {fleet.name}</Text>
        {i.memo && <Text style={s.small}>{i.memo}</Text>}
      </View>
      <Section style={{ marginTop: 0 }}>
        <Card>
          <KV k="Issued" v={dateLabel(i.issued_on)} />
          <KV k="Due" v={`${dateLabel(i.due_on)} · Net ${fleet.payment_terms_days}`} />
          {lines.map((l) => <KV key={l.id} k={l.description} v={money(l.amount)} />)}
          <KV k="Sales tax" v={Number(i.tax) ? money(i.tax) : 'Per NC rules (CPA)'} />
          <KV k="Total" v={money(i.total)} strong last={!i.paid_at} />
          {i.paid_at && <KV k="Paid" v={`${dateLabel(i.paid_at)} · ${i.payment_method?.toUpperCase() ?? ''}`} last />}
        </Card>
        {isAdmin && Number(i.platform_fee_amount) > 0 && <Note>Platform fee: {money(i.platform_fee_amount)}</Note>}
      </Section>
      {i.activity_id && <Section><Button title={`View repair activity #${i.activity_id}`} onPress={() => router.push(`/activity/${i.activity_id}`)} /></Section>}
      {i.status === 'open' && !isAdmin && (
        <Section><Button title={`Pay ${money(i.total)}`} kind="primary" busy={busy} onPress={() => run(() => payInvoices([i.id]))} /></Section>
      )}
      {isAdmin && ['open', 'processing'].includes(i.status) && (
        <Section style={{ gap: 10 }}>
          <Button title="Record payment (check / ACH outside Stripe)" busy={busy} onPress={async () => {
            if (await ask('Record payment?', `Mark ${i.number} paid in full (${money(i.total)}).`, 'Mark paid')) run(() => rpc('record_payment', { p_invoice: i.id, p_method: 'manual' }));
          }} />
          {i.status === 'open' && <Button title="Void invoice" kind="danger" busy={busy} onPress={async () => {
            if (await ask('Void invoice?', `${i.number} will no longer be due.`, 'Void', true)) run(() => rpc('void_invoice', { p_invoice: i.id }));
          }} />}
        </Section>
      )}
    </Screen>
  );
}
