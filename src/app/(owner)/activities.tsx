import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ItemRow } from '../../components/rows';
import { Empty, Header, Loading, Row, Screen, Section, Seg } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { loadFleet } from '../../lib/fleet';
import { num } from '../../lib/format';
import { byCat, CATS, RECENT_DAYS, SOON_HRS, SOON_MI, type Cat } from '../../lib/schedule';
import { useData } from '../../lib/useData';

const EMPTY: Record<string, string> = {
  Ongoing: 'No open repair activities.',
  Upcoming: `Nothing due within ${num(SOON_MI)} mi or ${SOON_HRS} engine hrs.`,
  Overdue: 'Nothing overdue. Every truck is within its OEM intervals.',
  Completed: `Nothing finished in the last ${RECENT_DAYS} days. Older work is in repair history.`,
};

export default function Activities() {
  const { fleet } = useAuth();
  const params = useLocalSearchParams<{ tab?: Cat }>();
  const [tab, setTab] = useState<(typeof CATS)[number]>('Ongoing');
  useEffect(() => { if (params.tab && (CATS as readonly string[]).includes(params.tab)) setTab(params.tab as (typeof CATS)[number]); }, [params.tab]);
  const { data, error, loading, reload } = useData(() => loadFleet(fleet!.id), [fleet?.id]);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const g = byCat(data.vehicles, data.intervals, data.acts);
  const counts = Object.fromEntries(CATS.map((k) => [k, g[k].length])) as Record<(typeof CATS)[number], number>;
  return (
    <Screen edges={['top']} refreshing={loading} onRefresh={reload}>
      <Header title="Repair activities" />
      <Section style={{ marginTop: 6 }}>
        <Seg options={CATS} value={tab} onChange={setTab} counts={counts} />
      </Section>
      <Section style={{ marginTop: 10 }}>
        {g[tab].length ? g[tab].map((x, i) => <ItemRow key={i} x={x} vehicles={data.vehicles} showUnit />) : <Empty>{EMPTY[tab]}</Empty>}
        <Row title="Repair history" meta={`${g.History.length} past repair activit${g.History.length === 1 ? 'y' : 'ies'}`} icon="time-outline"
          onPress={() => router.push('/history')} />
      </Section>
    </Screen>
  );
}
