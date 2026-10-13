// Admin gate: review every draft OEM interval for a fleet before it goes live.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, Empty, Loading, Note, Screen, Section, s } from '../../components/ui';
import { say } from '../../lib/alert';
import { loadFleet } from '../../lib/fleet';
import { errorMessage, money, num } from '../../lib/format';
import { rpc } from '../../lib/supabase';
import { C, TONES } from '../../lib/theme';
import { useData } from '../../lib/useData';

export default function Review() {
  const { fleet } = useLocalSearchParams<{ fleet: string }>();
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useData(() => loadFleet(fleet), [fleet]);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const drafts = data.intervals.filter((i) => i.status === 'draft');
  const chosen = drafts.filter((d) => sel[d.id] ?? true).map((d) => d.id);

  const confirm = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const n = await rpc<number>('confirm_intervals', { p_ids: ids });
      setSel({});
      await reload();
      say(`${n} interval${n === 1 ? '' : 's'} confirmed`, 'They are live: reminders, forecasts and scheduling now use them.');
    } catch (e) { say('Could not confirm', errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Screen onRefresh={reload}>
      <View style={{ padding: 16 }}>
        <Text style={s.h1}>{data.org.name}</Text>
        <Text style={s.sub}>{drafts.length} draft interval{drafts.length === 1 ? '' : 's'}. Check each against the OEM manual (the data plate wins). Tap a row to edit; untick to leave it as a draft.</Text>
      </View>
      {!drafts.length && <Section style={{ marginTop: 0 }}><Empty>Nothing to review. Every interval for this fleet is confirmed.</Empty></Section>}
      {data.vehicles.map((v) => {
        const mine = drafts.filter((d) => d.vehicle_id === v.id);
        if (!mine.length) return null;
        return (
          <Section key={v.id} title={`Unit ${v.unit_number} · ${[v.year, v.make, v.model].filter(Boolean).join(' ')}`}>
            <Card>
              {mine.map((it, i) => {
                const on = sel[it.id] ?? true;
                const every = [it.every_miles && `${num(it.every_miles)} mi`, it.every_hours && `${num(it.every_hours)} hrs`, it.every_days && `${it.every_days} days`].filter(Boolean).join(' / ');
                return (
                  <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: i === mine.length - 1 ? 0 : 1, borderBottomColor: C.line }}>
                    <Pressable onPress={() => setSel({ ...sel, [it.id]: !on })} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                      style={{ width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: on ? C.amber : C.line2, backgroundColor: on ? C.amber : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <Text style={{ color: C.amberInk, fontWeight: '900' }}>✓</Text>}
                    </Pressable>
                    <Pressable style={{ flex: 1 }} onPress={() => router.push(`/interval/${it.id}`)}>
                      <Text style={s.ttl}>{it.task}</Text>
                      <Text style={s.meta}>every {every} · {it.book_hours} hrs book · {money(it.est_parts_cost)} parts</Text>
                      <Text style={[s.small, it.source_ref?.startsWith('SAMPLE') && { color: TONES.amb.fg }]}>{it.source_ref ?? 'No OEM source recorded'}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </Card>
          </Section>
        );
      })}
      {drafts.length > 0 && (
        <Section style={{ gap: 10 }}>
          <Button title={`Confirm ${chosen.length} selected`} kind="primary" busy={busy} disabled={!chosen.length} onPress={() => confirm(chosen)} />
          <Note>Confirmed intervals drive reminders, the calendar and the owner’s schedule. Record the OEM manual & section as the source.</Note>
        </Section>
      )}
    </Screen>
  );
}
