// Every invoice flowing through the platform; platform fee as revenue; aging;
// monthly plan invoices; CSV export for QuickBooks (don't build a ledger — sync to QBO).
import { useState } from 'react';
import { View } from 'react-native';
import { InvoiceRow } from '../../components/rows';
import { Button, Card, Empty, Header, KV, Loading, Note, Screen, Section, Seg, Tile, s } from '../../components/ui';
import { ask, say } from '../../lib/alert';
import { loadPlatform } from '../../lib/admin';
import { exportCsv } from '../../lib/export';
import { errorMessage, money, money0, sum } from '../../lib/format';
import { aging, invoiceState } from '../../lib/schedule';
import { must, rpc, supabase } from '../../lib/supabase';
import type { InvoiceLine } from '../../lib/types';
import { useData } from '../../lib/useData';

const TABS = ['Open', 'Past due', 'Paid', 'All'] as const;

export default function Money() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Open');
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useData(loadPlatform);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const { invoices, fleets, vehicles } = data;
  const open = invoices.filter((i) => i.status === 'open' || i.status === 'processing');
  const late = open.filter((i) => invoiceState(i).late);
  const paid = invoices.filter((i) => i.status === 'paid');
  const list = tab === 'Open' ? open : tab === 'Past due' ? late : tab === 'Paid' ? paid : invoices;
  const b = aging(invoices);
  const fleetName = (id: string) => fleets.find((f) => f.id === id)?.name ?? '';

  const planRun = async () => {
    const d = new Date(); const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    if (!(await ask('Generate plan invoices?', `Monthly plan invoices for ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} (trucks × fee) for every active fleet. Runs automatically on the 1st.`, 'Generate'))) return;
    setBusy(true);
    try { const n = await rpc<number>('generate_plan_invoices', { p_period: period }); say(`${n} plan invoice${n === 1 ? '' : 's'} created`); reload(); }
    catch (e) { say('Could not generate', errorMessage(e)); } finally { setBusy(false); }
  };

  const csv = async () => {
    const ids = invoices.map((i) => i.id);
    const lines = ids.length ? must(await supabase.from('invoice_lines').select('*').in('invoice_id', ids)) as InvoiceLine[] : [];
    // one row per line — maps onto QuickBooks Online's invoice import columns
    await exportCsv(`northgate-invoices-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Status', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Unit', 'Memo', 'PlatformFee'],
      ...lines.map((l) => {
        const i = invoices.find((x) => x.id === l.invoice_id)!;
        return [i.number, fleetName(i.fleet_org_id), i.issued_on, i.due_on, i.status,
          l.line_type === 'labor' ? 'Labor' : l.line_type === 'part' ? 'Parts (at cost)' : l.line_type === 'fee' ? 'Plan fee' : 'Sublet',
          l.description, l.quantity, l.unit_price, l.amount, vehicles.find((v) => v.id === l.vehicle_id)?.unit_number ?? '', i.memo, i.platform_fee_amount];
      }),
    ]);
  };

  return (
    <Screen edges={['top']} refreshing={loading} onRefresh={reload}>
      <Header title="Money" sub="Every invoice through Northgate" />
      <Section style={{ marginTop: 6 }}>
        <View style={s.grid}>
          <Tile n={money0(sum(open, (i) => i.total))} label="Receivable" />
          <Tile n={money0(sum(late, (i) => i.total))} label="Past due" tone={late.length ? 'red' : undefined} />
          <Tile n={money0(sum(paid, (i) => i.total))} label="Collected" tone="grn" />
        </View>
      </Section>
      <Section title="Revenue to date">
        <Card>
          <KV k="Labor billed" v={money(sum(invoices.filter((i) => i.kind === 'service'), (i) => i.subtotal))} sub="Service invoices (labor + parts at cost)" />
          <KV k="Monthly plan fees" v={money(sum(invoices.filter((i) => i.kind === 'plan'), (i) => i.total))} />
          <KV k="Platform fee (collected)" v={money(sum(paid, (i) => i.platform_fee_amount))} sub="Comes off automatically via Stripe Connect" last />
        </Card>
        <Note>Parts are pass-through; the margin is labor plus the monthly fee.</Note>
      </Section>
      <Section title="Receivables aging">
        <Card>
          {Object.entries(b).map(([k, v], i, arr) => (
            <KV key={k} k={k === 'Current' ? 'Not yet due' : `${k} days late`} v={money(v)} color={v && k !== 'Current' ? '#FF9A9A' : undefined} last={i === arr.length - 1} />
          ))}
        </Card>
      </Section>
      <Section>
        <Seg options={TABS} value={tab} onChange={setTab} counts={{ Open: open.length, 'Past due': late.length, Paid: paid.length, All: invoices.length }} />
        <View style={{ marginTop: 10 }}>
          {list.length ? list.slice(0, 100).map((i) => <InvoiceRow key={i.id} i={i} fleet={fleetName(i.fleet_org_id)}
            unit={vehicles.find((v) => v.id === i.vehicle_id)?.unit_number} />) : <Empty>Nothing here.</Empty>}
        </View>
      </Section>
      <Section style={{ gap: 10 }}>
        <Button title="Generate this month’s plan invoices" onPress={planRun} busy={busy} />
        <Button title="Export for QuickBooks (CSV)" kind="ghost" onPress={() => csv().catch((e) => say('Export failed', errorMessage(e)))} />
      </Section>
    </Screen>
  );
}
