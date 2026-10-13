// Work queue across every fleet (Admin runs PG Heavy Duty's queue in stage one).
import { useState } from 'react';
import { ActivityRow } from '../../components/rows';
import { Chips, Empty, Header, Loading, Screen, Section } from '../../components/ui';
import { loadPlatform } from '../../lib/admin';
import type { RepairActivity } from '../../lib/types';
import { useData } from '../../lib/useData';

const TABS = {
  'Needs estimate': (a: RepairActivity) => a.status === 'requested',
  Breakdowns: (a: RepairActivity) => a.kind === 'breakdown' && ['requested', 'estimate', 'scheduled', 'progress'].includes(a.status),
  'Awaiting owner': (a: RepairActivity) => a.status === 'estimate',
  Scheduled: (a: RepairActivity) => a.status === 'scheduled',
  'In progress': (a: RepairActivity) => a.status === 'progress',
  Deferred: (a: RepairActivity) => a.status === 'deferred',
  Completed: (a: RepairActivity) => a.status === 'done',
};
type Tab = keyof typeof TABS;

export default function Work() {
  const [tab, setTab] = useState<Tab>('Needs estimate');
  const { data, error, loading, reload } = useData(loadPlatform);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const labels = (Object.keys(TABS) as Tab[]).map((k) => `${k} · ${data.acts.filter(TABS[k]).length}`);
  const list = data.acts.filter(TABS[tab]).sort((a, b) =>
    tab === 'Scheduled' ? (a.scheduled_for ?? '').localeCompare(b.scheduled_for ?? '') : b.id - a.id).slice(0, 100);
  const tag = (a: RepairActivity) =>
    `${data.vehicles.find((v) => v.id === a.vehicle_id)?.unit_number ?? ''} · ${data.fleets.find((f) => f.id === a.fleet_org_id)?.name ?? ''}`;
  return (
    <Screen edges={['top']} refreshing={loading} onRefresh={reload}>
      <Header title="Work queue" sub="PG Heavy Duty · all customers" />
      <Section style={{ marginTop: 6 }}>
        <Chips options={labels} value={labels[(Object.keys(TABS) as Tab[]).indexOf(tab)]}
          onChange={(l) => setTab(l.split(' · ')[0] as Tab)} />
      </Section>
      <Section>
        {list.length ? list.map((a) => <ActivityRow key={a.id} a={a} unit={tag(a)} />) : <Empty>Nothing here.</Empty>}
      </Section>
    </Screen>
  );
}
