// Fleet-owner accounting: balance due, past due, paid to date; open & paid invoices;
// Pay / Pay-all (Stripe, ACH first); spend by truck; statement + year-end summary.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { InvoiceRow } from '../../components/rows';
import { Button, Card, Empty, Header, KV, Loading, Note, Screen, Section, Seg, Tile, s } from '../../components/ui';
import { ask, say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { exportCsv, exportPdf, statementHtml, yearEndHtml } from '../../lib/export';
import { errorMessage, money, money0, sum } from '../../lib/format';
import { payInvoices } from '../../lib/pay';
import { invoiceState } from '../../lib/schedule';
import { must, supabase } from '../../lib/supabase';
import type { Invoice, InvoiceLine, Organization, Vehicle } from '../../lib/types';
import { useData } from '../../lib/useData';

export default function Accounting() {
  const { fleet } = useAuth();
  const params = useLocalSearchParams<{ paid?: string; cancelled?: string }>();
  const [tab, setTab] = useState<'Open' | 'Paid'>('Open');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (params.paid) say('Payment received', 'Bank (ACH) payments show as Processing until they settle.'); }, [params.paid]);

  const { data, error, loading, reload } = useData(async () => {
    const [org, invoices, vehicles] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', fleet!.id).single().then(must),
      supabase.from('invoices').select('*').eq('fleet_org_id', fleet!.id).neq('status', 'void').order('issued_on', { ascending: false }).then(must),
      supabase.from('vehicles').select('*').eq('fleet_org_id', fleet!.id).order('unit_number').then(must),
    ]);
    return { org: org as Organization, invoices: invoices as Invoice[], vehicles: vehicles as Vehicle[] };
  }, [fleet?.id]);
  if (!data) return <Loading error={error} onRetry={reload} />;

  const { org, invoices, vehicles } = data;
  const open = invoices.filter((i) => i.status === 'open' || i.status === 'processing');
  const payable = invoices.filter((i) => i.status === 'open');
  const paid = invoices.filter((i) => i.status === 'paid');
  const late = open.filter((i) => invoiceState(i).late);
  const unit = (id: string | null) => vehicles.find((v) => v.id === id)?.unit_number;
  const list = tab === 'Open' ? open : paid;

  const payAll = async () => {
    if (!(await ask(`Pay ${money(sum(payable, (i) => i.total))}?`, `${payable.length} open invoice${payable.length > 1 ? 's' : ''}. Bank transfer (ACH) is preferred — card fees eat into parts-at-cost.`, 'Continue'))) return;
    setBusy(true);
    try { await payInvoices(payable.map((i) => i.id)); } catch (e) { say('Could not start payment', errorMessage(e)); } finally { setBusy(false); }
  };

  const year = new Date().getFullYear();
  const yearEnd = async () => {
    const ids = invoices.map((i) => i.id);
    const lines = ids.length ? must(await supabase.from('invoice_lines').select('*').in('invoice_id', ids)) as InvoiceLine[] : [];
    await exportPdf(`Year-end ${year}`, yearEndHtml(org, year, invoices, lines, Object.fromEntries(vehicles.map((v) => [v.id, v.unit_number]))));
  };
  const csv = () => exportCsv(`${org.name.replace(/\W+/g, '-')}-invoices-${year}.csv`, [
    ['Invoice', 'Kind', 'Unit', 'Issued', 'Due', 'Status', 'Paid', 'Subtotal', 'Tax', 'Total', 'Memo'],
    ...invoices.map((i) => [i.number, i.kind, unit(i.vehicle_id) ?? '', i.issued_on, i.due_on, i.status, i.paid_at?.slice(0, 10) ?? '', i.subtotal, i.tax, i.total, i.memo]),
  ]);

  return (
    <Screen edges={['top']} refreshing={loading} onRefresh={reload}>
      <Header title="Accounting" sub={`${org.name}${org.account_number ? ` · Account ${org.account_number}` : ''}`} />
      <Section style={{ marginTop: 6 }}>
        <View style={s.grid}>
          <Tile n={money0(sum(open, (i) => i.total))} label="Balance due" />
          <Tile n={money0(sum(late, (i) => i.total))} label="Past due" tone={late.length ? 'red' : undefined} />
          <Tile n={money0(sum(paid, (i) => i.total))} label="Paid to date" tone="grn" />
        </View>
      </Section>
      {payable.length > 0 && (
        <Section><Button title={`Pay all open invoices · ${money(sum(payable, (i) => i.total))}`} kind="primary" onPress={payAll} busy={busy} /></Section>
      )}
      <Section>
        <Seg options={['Open', 'Paid'] as const} value={tab} onChange={setTab} counts={{ Open: open.length, Paid: paid.length }} />
        <View style={{ marginTop: 10 }}>
          {list.length ? list.map((i) => <InvoiceRow key={i.id} i={i} unit={unit(i.vehicle_id)} />) : <Empty>Nothing here.</Empty>}
        </View>
      </Section>
      <Section title="Spend by truck">
        <Card>
          {vehicles.map((v) => (
            <KV key={v.id} k={`Unit ${v.unit_number} · ${v.make ?? ''}`} v={money(sum(invoices.filter((i) => i.vehicle_id === v.id), (i) => i.total))} />
          ))}
          <KV k="Monthly plan" v={money(sum(invoices.filter((i) => i.kind === 'plan'), (i) => i.total))} last />
        </Card>
        <Note>Sales tax on parts and repair labor for commercial trucks in NC is pending CPA confirmation.</Note>
      </Section>
      <Section style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Statement (PDF)" style={{ flex: 1 }} onPress={() => exportPdf('Statement', statementHtml(org, invoices)).catch((e) => say('Export failed', errorMessage(e)))} />
        <Button title={`Year-end ${year}`} style={{ flex: 1 }} onPress={() => yearEnd().catch((e) => say('Export failed', errorMessage(e)))} />
      </Section>
      <Section style={{ marginTop: 8 }}>
        <Button title="Export invoices (CSV)" kind="ghost" onPress={() => csv().catch((e) => say('Export failed', errorMessage(e)))} />
      </Section>
    </Screen>
  );
}
