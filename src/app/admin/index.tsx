// Admin overview: every org, operations (open work, approvals, overdue, trucks down),
// money flowing through, and the signup / interval-review gate.
import { router } from 'expo-router';
import { View } from 'react-native';
import { ActivityRow } from '../../components/rows';
import { Button, Card, Header, KV, Loading, Pill, Row, Screen, Section, Tile, s } from '../../components/ui';
import { say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { loadPlatform } from '../../lib/admin';
import { errorMessage, money, sum } from '../../lib/format';
import { forecasts, invoiceState, isOpen } from '../../lib/schedule';
import { rpc } from '../../lib/supabase';
import { useData } from '../../lib/useData';

export default function Overview() {
  const { session } = useAuth();
  const { data, error, loading, reload } = useData(loadPlatform);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const { fleets, vehicles, intervals, acts, invoices } = data;
  const open = acts.filter(isOpen);
  const pending = fleets.filter((f) => f.status === 'pending');
  const drafts = intervals.filter((i) => i.status === 'draft');
  const overdue = forecasts(vehicles, intervals, acts).filter((f) => f.due.over && !f.deferred);
  const receivable = invoices.filter((i) => i.status === 'open' || i.status === 'processing');
  const late = receivable.filter((i) => invoiceState(i).late);
  const breakdowns = acts.filter((a) => a.kind === 'breakdown' && isOpen(a));
  const needEstimate = acts.filter((a) => a.status === 'requested');
  const unit = (id: string) => vehicles.find((v) => v.id === id)?.unit_number;
  const fleetName = (id: string) => fleets.find((f) => f.id === id)?.name ?? '';
  const draftFleets = [...new Set(drafts.map((d) => vehicles.find((v) => v.id === d.vehicle_id)?.fleet_org_id).filter(Boolean))] as string[];

  const approve = async (id: string) => {
    try { await rpc('admin_set_org_status', { p_org: id, p_status: 'active' }); reload(); }
    catch (e) { say('Could not approve', errorMessage(e)); }
  };

  return (
    <Screen edges={['top']} refreshing={loading} onRefresh={reload}>
      <Header title="Northgate overview" sub={`Admin · ${session?.user.email ?? ''}`} />
      <Section style={{ marginTop: 8 }}>
        <View style={s.grid}>
          <Tile n={fleets.length} label="Fleets" onPress={() => router.push('/admin/customers')} />
          <Tile n={vehicles.length} label="Trucks" />
          <Tile n={pending.length} label="Pending signups" tone={pending.length ? 'amb' : undefined} />
          <Tile n={drafts.length} label="Intervals to review" tone={drafts.length ? 'amb' : undefined} />
        </View>
      </Section>

      {(pending.length > 0 || draftFleets.length > 0) && (
        <Section title="The gate">
          {pending.map((f) => (
            <Row key={f.id} title={f.name} meta={`Self-signup · ${vehicles.filter((v) => v.fleet_org_id === f.id).length} trucks`} icon="person-add-outline" tone="amb"
              small={f.trial_ends_at ? `Trial ends ${f.trial_ends_at}` : undefined}
              right={<Button title="Approve" onPress={() => approve(f.id)} style={{ minHeight: 40 }} />}
              onPress={() => router.push(`/customer/${f.id}`)} />
          ))}
          {draftFleets.map((id) => (
            <Row key={id} title={`Review OEM schedules · ${fleetName(id)}`} meta={`${drafts.filter((d) => vehicles.find((v) => v.id === d.vehicle_id)?.fleet_org_id === id).length} draft intervals`}
              icon="checkmark-done-outline" tone="amb" onPress={() => router.push(`/review/${id}`)} />
          ))}
        </Section>
      )}

      {breakdowns.length > 0 && (
        <Section title="Breakdowns">
          {breakdowns.map((a) => <ActivityRow key={a.id} a={a} unit={`${unit(a.vehicle_id)} · ${fleetName(a.fleet_org_id)}`} />)}
        </Section>
      )}
      {needEstimate.filter((a) => a.kind !== 'breakdown').length > 0 && (
        <Section title="Needs an estimate">
          {needEstimate.filter((a) => a.kind !== 'breakdown').map((a) => <ActivityRow key={a.id} a={a} unit={`${unit(a.vehicle_id)} · ${fleetName(a.fleet_org_id)}`} />)}
        </Section>
      )}

      <Section title="Operations">
        <Card>
          <KV k="Open repair activities" v={open.length} />
          <KV k="Waiting on owner approval" v={acts.filter((a) => a.status === 'estimate').length} />
          <KV k="In progress" v={acts.filter((a) => a.status === 'progress').length} />
          <KV k="Overdue (not scheduled)" v={overdue.length} color={overdue.length ? '#FF9A9A' : undefined} />
          <KV k="Trucks out of service" v={vehicles.filter((v) => !v.in_service).length} last />
        </Card>
      </Section>

      <Section title="Money">
        <Card>
          <KV k="Receivable" v={money(sum(receivable, (i) => i.total))} />
          <KV k="Past due" v={money(sum(late, (i) => i.total))} color={late.length ? '#FF9A9A' : undefined} />
          <KV k="Collected to date" v={money(sum(invoices.filter((i) => i.status === 'paid'), (i) => i.total))} />
          <KV k="Platform fee revenue" v={money(sum(invoices.filter((i) => i.status === 'paid'), (i) => i.platform_fee_amount))} last />
        </Card>
      </Section>

      <Section title="Customers">
        {fleets.map((f) => (
          <Row key={f.id} title={f.name} icon="bus-outline" tone="amb"
            meta={`${f.account_number ? `Account ${f.account_number} · ` : ''}${vehicles.filter((v) => v.fleet_org_id === f.id).length} trucks · ${open.filter((a) => a.fleet_org_id === f.id).length} open`}
            right={<Pill label={f.status === 'active' ? 'Active' : f.status === 'pending' ? 'Pending' : 'Suspended'} tone={f.status === 'active' ? 'grn' : f.status === 'pending' ? 'amb' : 'red'} />}
            onPress={() => router.push(`/customer/${f.id}`)} />
        ))}
        <Button title="Add customer" kind="primary" icon="add" onPress={() => router.push('/new-customer')} style={{ marginTop: 4 }} />
      </Section>
    </Screen>
  );
}
