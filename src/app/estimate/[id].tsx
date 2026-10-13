// Provider estimate editor (Admin in stage one): labor = book hrs × rate, parts at cost.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, Chips, Field, KV, Loading, Note, Screen, Section, s } from '../../components/ui';
import { say } from '../../lib/alert';
import { errorMessage, money } from '../../lib/format';
import { must, rpc, supabase } from '../../lib/supabase';
import { C } from '../../lib/theme';
import type { EstimateLine, LineKind, RepairActivity, ServiceInterval, Vehicle } from '../../lib/types';
import { useData } from '../../lib/useData';

interface Draft { kind: LineKind; description: string; part_number: string; book_hours: string; quantity: string; unit_price: string }
const KINDS: LineKind[] = ['labor', 'part', 'fee', 'sublet'];
const blank = (kind: LineKind = 'part'): Draft => ({ kind, description: '', part_number: '', book_hours: '', quantity: '1', unit_price: '' });

export default function Estimate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [lines, setLines] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useData(async () => {
    const a = must(await supabase.from('repair_activities').select('*').eq('id', id).single()) as RepairActivity;
    const [v, existing, interval] = await Promise.all([
      supabase.from('vehicles').select('*').eq('id', a.vehicle_id).single().then(must),
      supabase.from('estimate_lines').select('*').eq('activity_id', id).order('position').then(must),
      a.interval_id ? supabase.from('service_intervals').select('*').eq('id', a.interval_id).single().then(must) : null,
    ]);
    return { a, v: v as Vehicle, existing: existing as EstimateLine[], interval: interval as ServiceInterval | null };
  }, [id]);

  useEffect(() => {
    if (!data || lines.length) return;
    if (data.existing.length) {
      setLines(data.existing.map((l) => ({ kind: l.kind, description: l.description, part_number: l.part_number ?? '',
        book_hours: l.book_hours != null ? String(l.book_hours) : '', quantity: String(l.quantity), unit_price: String(l.unit_price) })));
    } else {
      const it = data.interval;
      setLines([
        { ...blank('labor'), description: it ? `Labor · ${it.task} (OEM book time)` : `Labor · ${data.a.title}`, book_hours: it ? String(it.book_hours) : '' },
        { ...blank('part'), description: it ? `Parts · ${it.component_category}` : 'Parts', unit_price: it ? String(it.est_parts_cost) : '' },
      ]);
    }
  }, [data]);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const rate = Number(data.a.labor_rate ?? 150);

  const amount = (l: Draft) => l.kind === 'labor' ? (Number(l.book_hours) || 0) * (Number(l.unit_price) || rate) : (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
  const total = lines.reduce((t, l) => t + amount(l), 0);
  const upd = (i: number, patch: Partial<Draft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const send = async () => {
    const bad = lines.find((l) => !l.description.trim() || (l.kind === 'labor' ? !Number(l.book_hours) : !(Number(l.quantity) >= 0) || l.unit_price === ''));
    if (bad) return say('Finish every line', 'Labor needs book hours; other lines need a quantity and price.');
    setBusy(true);
    try {
      await rpc('send_estimate', { p_activity: data.a.id, p_lines: lines.map((l) => l.kind === 'labor'
        ? { kind: 'labor', description: l.description.trim(), book_hours: Number(l.book_hours), quantity: Number(l.book_hours), unit_price: Number(l.unit_price) || rate }
        : { kind: l.kind, description: l.description.trim(), part_number: l.part_number.trim() || null, quantity: Number(l.quantity), unit_price: Number(l.unit_price) }) });
      router.back();
      say('Estimate sent', 'The owner has been notified to approve it.');
    } catch (e) { say('Could not send estimate', errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <View style={{ padding: 16 }}>
        <Text style={s.h1}>RA #{data.a.id}</Text>
        <Text style={{ color: C.soft }}>Unit {data.v.unit_number} · {data.a.title}</Text>
        {data.a.description && <Text style={s.small}>Owner’s note: “{data.a.description}”</Text>}
      </View>
      {lines.map((l, i) => (
        <Section key={i} style={{ marginTop: 8 }}>
          <Card pad={false} style={{ padding: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={s.ttl}>Line {i + 1}</Text>
              <Pressable onPress={() => setLines(lines.filter((_, j) => j !== i))} accessibilityLabel={`Remove line ${i + 1}`}>
                <Text style={{ color: '#FF9A9A', fontWeight: '700' }}>Remove</Text>
              </Pressable>
            </View>
            <Chips options={KINDS} value={l.kind} onChange={(k) => upd(i, { kind: k })} />
            <Field label="Description" value={l.description} onChangeText={(t) => upd(i, { description: t })} />
            {l.kind === 'labor' ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Field label="Book hours" value={l.book_hours} onChangeText={(t) => upd(i, { book_hours: t })} keyboardType="decimal-pad" /></View>
                <View style={{ flex: 1 }}><Field label="Rate $/hr" value={l.unit_price} placeholder={String(rate)} onChangeText={(t) => upd(i, { unit_price: t })} keyboardType="decimal-pad" /></View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {l.kind === 'part' && <View style={{ flex: 1.3 }}><Field label="Part #" value={l.part_number} onChangeText={(t) => upd(i, { part_number: t })} autoCapitalize="characters" /></View>}
                <View style={{ flex: 0.8 }}><Field label="Qty" value={l.quantity} onChangeText={(t) => upd(i, { quantity: t })} keyboardType="decimal-pad" /></View>
                <View style={{ flex: 1 }}><Field label={l.kind === 'part' ? 'Your cost $' : 'Price $'} value={l.unit_price} onChangeText={(t) => upd(i, { unit_price: t })} keyboardType="decimal-pad" /></View>
              </View>
            )}
            <Text style={[s.meta, { marginTop: 8, textAlign: 'right' }]}>{money(amount(l))}</Text>
          </Card>
        </Section>
      ))}
      <Section style={{ marginTop: 8 }}>
        <Button title="Add line" icon="add" kind="ghost" onPress={() => setLines([...lines, blank()])} />
      </Section>
      <Section>
        <Card><KV k="Total" v={money(total)} strong last /></Card>
        <Note>PG Heavy Duty policy: parts at cost (no markup), labor from OEM book time.</Note>
        <Button title="Send estimate to owner" kind="primary" onPress={send} busy={busy} style={{ marginTop: 12 }} />
      </Section>
    </Screen>
  );
}
