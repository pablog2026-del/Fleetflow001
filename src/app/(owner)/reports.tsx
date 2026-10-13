// Fleet reporting: cost per mile & per engine hour by truck, spend by category,
// downtime days, PM compliance, DOT-ready file per truck; PDF + CSV export.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, Chips, Header, KV, Loading, Note, Screen, Section, Tile, s } from '../../components/ui';
import { say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { categoryLabel, dotFileHtml, exportCsv, exportPdf, fleetReportCsv, fleetReportHtml } from '../../lib/export';
import { errorMessage, isoDate, money, money0 } from '../../lib/format';
import { must, rpc, supabase } from '../../lib/supabase';
import { C } from '../../lib/theme';
import type { DotFile, FleetReport, Organization } from '../../lib/types';
import { useData } from '../../lib/useData';

const PERIODS = ['30 days', '90 days', 'Year to date', '12 months'] as const;
const fromFor = (p: (typeof PERIODS)[number]) => {
  const d = new Date();
  if (p === 'Year to date') return new Date(d.getFullYear(), 0, 1);
  d.setDate(d.getDate() - (p === '30 days' ? 30 : p === '90 days' ? 90 : 365));
  return d;
};

export default function Reports() {
  const { fleet } = useAuth();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('90 days');
  const { data, error, loading, reload } = useData(async () => {
    const [r, org] = await Promise.all([
      rpc<FleetReport>('fleet_report', { p_fleet: fleet!.id, p_from: isoDate(fromFor(period)), p_to: isoDate(new Date()) }),
      supabase.from('organizations').select('*').eq('id', fleet!.id).single().then(must),
    ]);
    return { r, org: org as Organization };
  }, [fleet?.id, period]);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const { r, org } = data;
  const pct = r.totals.pm_done ? Math.round((r.totals.pm_on_time / r.totals.pm_done) * 100) : null;
  const cats = Object.entries(r.by_category).sort((a, b) => b[1] - a[1]);
  const catTotal = cats.reduce((t, [, v]) => t + Number(v), 0);

  const dot = async (vehicleId: string, unit: string) => {
    try { await exportPdf(`DOT file Unit ${unit}`, dotFileHtml(await rpc<DotFile>('dot_file', { p_vehicle: vehicleId }))); }
    catch (e) { say('Could not build DOT file', errorMessage(e)); }
  };

  return (
    <Screen edges={['top']} refreshing={loading} onRefresh={reload}>
      <Header title="Fleet reports" sub={org.name} />
      <Section style={{ marginTop: 6 }}><Chips options={PERIODS} value={period} onChange={setPeriod} /></Section>
      <Section>
        <View style={s.grid}>
          <Tile n={money0(r.totals.spend)} label="Spend" />
          <Tile n={r.totals.downtime_days} label="Downtime days" tone={r.totals.downtime_days ? 'red' : undefined} />
          <Tile n={pct == null ? '—' : `${pct}%`} label="PM on time" tone={pct == null ? undefined : pct >= 90 ? 'grn' : 'amb'} />
        </View>
        <Note>{r.totals.pm_on_time} of {r.totals.pm_done} PMs done on time · {r.totals.pm_overdue_now} overdue right now.</Note>
      </Section>

      <Section title="By truck">
        {r.trucks.map((t) => (
          <Card key={t.vehicle_id} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 }}>
              <Text style={s.ttl}>Unit {t.unit} · {[t.year, t.make].filter(Boolean).join(' ')}</Text>
              <Pressable onPress={() => dot(t.vehicle_id, t.unit)} accessibilityRole="button">
                <Text style={{ color: C.amber, fontWeight: '700' }}>DOT file</Text>
              </Pressable>
            </View>
            <KV k="Cost per mile" v={t.cost_per_mile != null ? `$${Number(t.cost_per_mile).toFixed(3)}` : '—'} sub={`${money(t.spend)} over ${Math.round(t.miles).toLocaleString()} mi`} />
            <KV k="Cost per engine hour" v={t.cost_per_hour != null ? money(t.cost_per_hour) : '—'} />
            <KV k="Downtime" v={`${t.downtime_days} days`} color={t.downtime_days ? '#FF9A9A' : undefined} />
            <KV k="PM compliance" v={t.pm_done ? `${t.pm_on_time}/${t.pm_done} on time` : 'No PMs in period'} sub={t.pm_overdue_now ? `${t.pm_overdue_now} overdue now` : undefined} last />
          </Card>
        ))}
        <Note>Miles and engine hours come from meter readings in the period (service visits and manual entries until telematics is connected).</Note>
      </Section>

      <Section title="Spend by category">
        <Card>
          {cats.length ? cats.map(([k, v], i) => (
            <KV key={k} k={categoryLabel(k)} sub={catTotal ? `${Math.round((Number(v) / catTotal) * 100)}% of spend` : undefined} v={money(v)} last={i === cats.length - 1} />
          )) : <KV k="No invoices in this period" v="" last />}
        </Card>
      </Section>

      <Section style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Report (PDF)" style={{ flex: 1 }} onPress={() => exportPdf('Fleet report', fleetReportHtml(org, r)).catch((e) => say('Export failed', errorMessage(e)))} />
        <Button title="Report (CSV)" style={{ flex: 1 }} onPress={() => exportCsv(`fleet-report-${r.from}-${r.to}.csv`, fleetReportCsv(r)).catch((e) => say('Export failed', errorMessage(e)))} />
      </Section>
    </Screen>
  );
}
