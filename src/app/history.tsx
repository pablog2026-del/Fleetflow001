import { useLocalSearchParams } from 'expo-router';
import { ActivityRow } from '../components/rows';
import { Empty, Header, Loading, Screen, Section } from '../components/ui';
import { loadFleet } from '../lib/fleet';
import { money } from '../lib/format';
import { byCat, RECENT_DAYS } from '../lib/schedule';
import { must, supabase } from '../lib/supabase';
import { useData } from '../lib/useData';
import { useFleetId } from '../lib/useFleetId';

export default function History() {
  const fleetId = useFleetId();
  const { unit } = useLocalSearchParams<{ unit?: string }>();
  const { data, error, reload } = useData(async () => {
    const f = await loadFleet(fleetId!);
    const totals = must(await supabase.from('invoices').select('activity_id, total').eq('fleet_org_id', fleetId!).eq('kind', 'service').neq('status', 'void'));
    return { ...f, totals: totals as { activity_id: number; total: number }[] };
  }, [fleetId], !!fleetId);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const vehicles = unit ? data.vehicles.filter((v) => v.id === unit) : data.vehicles;
  const list = byCat(vehicles, data.intervals, data.acts.filter((a) => !unit || a.vehicle_id === unit)).History;
  const ids = new Set(list.map((x) => (x.kind === 'activity' ? x.activity.id : 0)));
  const spent = data.totals.filter((t) => ids.has(t.activity_id)).reduce((s, t) => s + Number(t.total), 0);
  return (
    <Screen>
      <Header title={unit ? `Unit ${vehicles[0]?.unit_number}` : 'All units'} sub={`${list.length} record${list.length === 1 ? '' : 's'} · ${money(spent)} spent`} />
      <Section style={{ marginTop: 8 }}>
        {list.length ? list.map((x) => x.kind === 'activity' &&
          <ActivityRow key={x.activity.id} a={x.activity} unit={unit ? undefined : data.vehicles.find((v) => v.id === x.activity.vehicle_id)?.unit_number} />)
          : <Empty>No history yet. Repair activities move here {RECENT_DAYS} days after they’re completed.</Empty>}
      </Section>
    </Screen>
  );
}
