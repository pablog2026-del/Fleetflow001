import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Empty, Header, Loading, Pill, Row, Screen, Section, Seg } from '../../components/ui';
import { loadPlatform } from '../../lib/admin';
import { isOpen } from '../../lib/schedule';
import { useData } from '../../lib/useData';

const TABS = ['All', 'Active', 'Pending', 'Suspended'] as const;

export default function Customers() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('All');
  const { data, error, loading, reload } = useData(loadPlatform);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const list = data.fleets.filter((f) => tab === 'All' || f.status === tab.toLowerCase());
  return (
    <Screen edges={['top']} refreshing={loading} onRefresh={reload}>
      <Header title="Customers" sub="Fleets on Northgate" />
      <Section style={{ marginTop: 6 }}>
        <Button title="Add customer" kind="primary" icon="add" onPress={() => router.push('/new-customer')} />
      </Section>
      <Section>
        <Seg options={TABS} value={tab} onChange={setTab} counts={Object.fromEntries(TABS.map((t) => [t, data.fleets.filter((f) => t === 'All' || f.status === t.toLowerCase()).length]))} />
      </Section>
      <Section style={{ marginTop: 10 }}>
        {list.length ? list.map((f) => {
          const trucks = data.vehicles.filter((v) => v.fleet_org_id === f.id).length;
          const drafts = data.intervals.filter((i) => i.status === 'draft' && data.vehicles.find((v) => v.id === i.vehicle_id)?.fleet_org_id === f.id).length;
          return (
            <Row key={f.id} title={f.name} icon="business-outline" tone={f.status === 'pending' ? 'amb' : 'grey'}
              meta={`${f.account_number ? `Account ${f.account_number} · ` : ''}${trucks} trucks · ${data.acts.filter((a) => a.fleet_org_id === f.id && isOpen(a)).length} open`}
              small={`${f.signup_source === 'self' ? 'Self-signup' : 'Admin-created'}${drafts ? ` · ${drafts} intervals to review` : ''}`}
              right={<Pill label={f.status === 'active' ? 'Active' : f.status === 'pending' ? 'Pending' : 'Suspended'} tone={f.status === 'active' ? 'grn' : f.status === 'pending' ? 'amb' : 'red'} />}
              onPress={() => router.push(`/customer/${f.id}`)} />
          );
        }) : <Empty>No customers here.</Empty>}
      </Section>
    </Screen>
  );
}
