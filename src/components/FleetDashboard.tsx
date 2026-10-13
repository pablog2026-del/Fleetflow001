// Fleet-owner dashboard (from the simulator): trucks in/out of service, repair
// activity tiles, calendar + reminders, approvals, truck list, request / breakdown.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { ActivityRow } from './rows';
import { Calendar } from './Calendar';
import { Button, Card, Header, Loading, Pill, Row, Screen, Section, Tile, s } from './ui';
import { num } from '../lib/format';
import { loadFleet } from '../lib/fleet';
import { counts, truckStatus } from '../lib/schedule';
import { must, supabase } from '../lib/supabase';
import { C, TONES } from '../lib/theme';
import { useData } from '../lib/useData';

export function FleetDashboard({ fleetId, adminView }: { fleetId: string; adminView?: boolean }) {
  const { data, error, loading, reload } = useData(async () => {
    const [fleet, unread] = await Promise.all([
      loadFleet(fleetId),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).then((r) => r.count ?? 0),
    ]);
    return { ...fleet, unread };
  }, [fleetId]);
  if (!data) return <Loading error={error} onRetry={reload} />;

  const { org, vehicles, intervals, acts, unread } = data;
  const c = counts(vehicles, intervals, acts);
  const q = adminView ? `?fleet=${fleetId}` : '';
  const needs = acts.filter((a) => a.status === 'estimate');
  const drafts = intervals.filter((i) => i.status === 'draft').length;
  const trucks = [...vehicles]
    .map((v) => ({ v, st: truckStatus(v, intervals, acts) }))
    .sort((a, b) => Number(a.v.in_service) - Number(b.v.in_service) || a.st.rank - b.st.rank);

  return (
    <Screen edges={adminView ? ['bottom'] : ['top', 'bottom']} refreshing={loading} onRefresh={reload}>
      <View style={s.top}>
        <Pressable onPress={() => router.push(`/profile${q}`)} accessibilityRole="button" accessibilityLabel={`Open ${org.name} customer profile`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 }}>
          <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: '#2B2416', borderWidth: 1, borderColor: '#5E4820', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="business-outline" size={22} color={TONES.amb.fg} />
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={s.sub}>{org.account_number ? `Account ${org.account_number} · ` : ''}Customer profile</Text>
            <Text style={[s.h1, { fontSize: 26 }]} numberOfLines={1}>{org.name}</Text>
          </View>
        </Pressable>
        {!adminView && (
          <Pressable onPress={() => router.push('/notifications')} accessibilityLabel={`Notifications${unread ? `, ${unread} new` : ''}`}
            style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line2, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="notifications-outline" size={22} color={C.text} />
            {unread > 0 && (
              <View style={{ position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#FF6B6B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                <Text style={{ color: '#1A0D0D', fontSize: 12, fontWeight: '800' }}>{unread}</Text>
              </View>
            )}
          </Pressable>
        )}
      </View>

      {org.status === 'pending' && (
        <Section style={{ marginTop: 8 }}>
          <Card style={{ padding: 14, borderColor: TONES.amb.ln, backgroundColor: TONES.amb.bg }} pad={false}>
            <Text style={{ color: TONES.amb.fg, fontWeight: '700' }}>Trial · awaiting Northgate approval</Text>
            <Text style={[s.meta, { marginTop: 4 }]}>Add your trucks by VIN. Northgate reviews each OEM interval before it becomes official{org.trial_ends_at ? ` · trial ends ${org.trial_ends_at}` : ''}.</Text>
          </Card>
        </Section>
      )}
      {drafts > 0 && (
        <Section style={{ marginTop: 8 }}>
          <Card pad={false} style={{ padding: 14 }}>
            <Text style={s.ttl}>{drafts} OEM interval{drafts > 1 ? 's' : ''} pending review</Text>
            <Text style={s.meta}>Admin confirms every interval against the OEM spec before reminders start.</Text>
            {adminView && <Button title="Review now" onPress={() => router.push(`/review/${fleetId}`)} style={{ marginTop: 10 }} />}
          </Card>
        </Section>
      )}

      {vehicles.length === 0 ? (
        <Section>
          <Card pad={false} style={{ padding: 18, gap: 10 }}>
            <Text style={s.ttl}>No trucks yet</Text>
            <Text style={s.meta}>Add a truck by its VIN — we decode it with NHTSA and build its OEM schedule for review.</Text>
            <Button title="Add your first truck" kind="primary" icon="add" onPress={() => router.push(`/add-truck${q}`)} />
          </Card>
        </Section>
      ) : (
        <>
          <Section style={{ marginTop: 8 }}>
            <Card pad={false} style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ color: C.soft, fontWeight: '600' }}>Total trucks</Text>
                <Text style={{ color: C.text, fontSize: 28, fontWeight: '800' }}>{c.total}</Text>
              </View>
              <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, marginVertical: 10 }}>
                <View style={{ flex: c.inSvc, backgroundColor: '#4CC38A' }} />
                {c.outSvc > 0 && <View style={{ flex: c.outSvc, backgroundColor: '#FF6B6B' }} />}
              </View>
              <View style={{ flexDirection: 'row' }}>
                <Text style={[s.meta, { flex: 1 }]}><Text style={{ color: C.text, fontWeight: '800' }}>{c.inSvc}</Text> In service</Text>
                <Text style={[s.meta, { flex: 1 }]}><Text style={{ color: C.text, fontWeight: '800' }}>{c.outSvc}</Text> Out of service</Text>
              </View>
            </Card>
          </Section>

          <Section style={{ marginTop: 12 }}>
            <Text style={{ color: C.soft, fontWeight: '600', marginBottom: 8 }}>Repair activities</Text>
            <View style={s.grid}>
              <Tile n={c.ongoing} label="Ongoing" tone="blue" onPress={() => !adminView && router.push('/(owner)/activities?tab=Ongoing')} />
              <Tile n={c.upcoming} label="Upcoming" tone="amb" onPress={() => !adminView && router.push('/(owner)/activities?tab=Upcoming')} />
              <Tile n={c.overdue} label="Overdue" tone="red" onPress={() => !adminView && router.push('/(owner)/activities?tab=Overdue')} />
            </View>
          </Section>

          <Calendar vehicles={vehicles} intervals={intervals} acts={acts} lat={org.latitude} lon={org.longitude} />

          {needs.length > 0 && (
            <Section title="Needs your approval">
              {needs.map((a) => <ActivityRow key={a.id} a={a} unit={vehicles.find((v) => v.id === a.vehicle_id)?.unit_number} />)}
            </Section>
          )}

          <Section title="Trucks" right={<Pressable onPress={() => router.push(`/add-truck${q}`)}><Text style={{ color: C.amber, fontWeight: '700' }}>+ Add truck</Text></Pressable>}>
            {trucks.map(({ v, st }) => (
              <Row key={v.id} title={`Unit ${v.unit_number} · ${[v.year, v.make, v.model].filter(Boolean).join(' ')}`}
                small={`${num(v.odometer_miles)} mi`} icon="bus-outline"
                right={<Pill label={v.in_service ? 'In service' : 'Out of service'} tone={v.in_service ? 'grn' : 'red'} dot />}
                onPress={() => router.push(`/unit/${v.id}`)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, marginTop: 10 }}>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={s.small}>Service activity</Text>
                    <Text style={{ color: C.soft, fontSize: 14 }}>{st.line}</Text>
                  </View>
                  <Pill label={st.label} tone={st.tone} />
                </View>
              </Row>
            ))}
          </Section>
        </>
      )}

      {!adminView && vehicles.length > 0 && (
        <Section style={{ gap: 10 }}>
          <Button title="Request service" kind="primary" icon="add" onPress={() => router.push('/(owner)/request')} />
          <Button title="Report a breakdown" kind="danger" icon="warning-outline" onPress={() => router.push('/breakdown')} />
        </Section>
      )}
    </Screen>
  );
}
