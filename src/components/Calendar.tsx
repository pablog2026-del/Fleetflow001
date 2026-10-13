// Monthly calendar: scheduled / in-progress / completed repair activities (only
// once an RA exists), plus holiday and rain-risk interruption markers, and the
// reminders list for due/overdue work that is not scheduled yet.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fetchRain, interruption, iso, RAIN_HIGH, type RainMap } from '../lib/calendar';
import { dateLabel } from '../lib/format';
import { forecasts, projectedDate, startOfDay, type Forecast } from '../lib/schedule';
import { C, EV_COLOR } from '../lib/theme';
import type { RepairActivity, ServiceInterval, Vehicle } from '../lib/types';
import { Card, s } from './ui';

type Ev = { unit: string; kind: 'scheduled' | 'progress' | 'done'; text: string; act: number };

export function Calendar({ vehicles, intervals, acts, lat, lon }: {
  vehicles: Vehicle[]; intervals: ServiceInterval[]; acts: RepairActivity[]; lat?: number | null; lon?: number | null;
}) {
  const today = startOfDay(new Date());
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState(iso(today));
  const [rain, setRain] = useState<RainMap>({});
  useEffect(() => { fetchRain(lat ?? undefined, lon ?? undefined).then(setRain); }, [lat, lon]);

  const unitOf = (id: string) => vehicles.find((v) => v.id === id)?.unit_number ?? '?';
  const events = useMemo(() => {
    const ev: Record<string, Ev[]> = {};
    const add = (d: string | null | undefined, e: Ev) => { if (d) (ev[d.slice(0, 10)] ??= []).push(e); };
    for (const a of acts) {
      const u = unitOf(a.vehicle_id);
      if (a.status === 'scheduled') add(a.scheduled_for, { unit: u, kind: 'scheduled', text: `Unit ${u} · RA #${a.id} ${a.title}`, act: a.id });
      if (a.status === 'progress') add(iso(today), { unit: u, kind: 'progress', text: `Unit ${u} · RA #${a.id} ${a.title} (in progress)`, act: a.id });
      if (a.status === 'done' && a.completed_at) add(iso(new Date(a.completed_at)), { unit: u, kind: 'done', text: `Unit ${u} · RA #${a.id} ${a.title} completed`, act: a.id });
    }
    return ev;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acts, vehicles]);

  const month = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const first = month.getDay();
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysIn }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  while (cells.length % 7) cells.push(null);
  const PRI = { progress: 0, scheduled: 1, done: 2 } as const;

  const selDate = new Date(sel + 'T00:00:00');
  const si = interruption(selDate, rain);
  const sev = events[sel] ?? [];

  return (
    <View style={s.sec}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={s.h2}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <NavBtn icon="chevron-back" label="Previous month" disabled={offset <= 0} onPress={() => setOffset(offset - 1)} />
          <NavBtn icon="chevron-forward" label="Next month" onPress={() => setOffset(offset + 1)} />
        </View>
      </View>
      <Card pad={false} style={{ padding: 8 }}>
        <View style={{ flexDirection: 'row' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <Text key={d} style={{ flex: 1, textAlign: 'center', color: C.muted, fontSize: 12, fontWeight: '700' }}>{d}</Text>
          ))}
        </View>
        {Array.from({ length: cells.length / 7 }, (_, w) => (
          <View key={w} style={{ flexDirection: 'row', gap: 3, marginTop: 3 }}>
            {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
              if (!d) return <View key={i} style={{ flex: 1 }} />;
              const key = iso(d);
              const it = interruption(d, rain);
              const es = events[key] ?? [];
              const byUnit: Record<string, Ev['kind']> = {};
              for (const e of es) if (!byUnit[e.unit] || PRI[e.kind] < PRI[byUnit[e.unit]]) byUnit[e.unit] = e.kind;
              const units = Object.entries(byUnit).sort((a, b) => PRI[a[1]] - PRI[b[1]]);
              const isToday = key === iso(today), isSel = key === sel, past = d < today;
              return (
                <Pressable key={i} onPress={() => setSel(key)} accessibilityRole="button"
                  accessibilityLabel={`${dateLabel(key)}${it.hol ? ', ' + it.hol : ''}${it.rainy ? `, ${it.rain}% chance of rain` : ''}${es.length ? `, ${es.length} items` : ''}`}
                  style={{ flex: 1, minHeight: 64, borderRadius: 9, alignItems: 'center', paddingTop: 4,
                    backgroundColor: isSel ? '#2B2416' : it.hol ? '#251C33' : 'transparent',
                    borderWidth: isSel || isToday ? 1.5 : 1, borderColor: isSel ? C.amber : isToday ? '#6B7380' : 'transparent' }}>
                  <Text style={{ fontSize: 14, fontWeight: isToday ? '800' : '600', color: past ? '#5F6670' : it.weekend ? '#8E96A1' : C.text }}>{d.getDate()}</Text>
                  {units.slice(0, 3).map(([u, k]) => (
                    <Text key={u} style={{ fontSize: 11, fontWeight: '700', color: EV_COLOR[k], lineHeight: 13 }}>{u}</Text>
                  ))}
                  {units.length > 3 && <Text style={{ fontSize: 11, color: C.muted }}>+{units.length - 3}</Text>}
                  {it.rainy && <Ionicons name="water" size={10} color="#5FA8FF" style={{ position: 'absolute', top: 3, right: 3 }} />}
                  {it.hol && <View style={{ position: 'absolute', top: 4, left: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: '#B98CFF' }} />}
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 10, paddingHorizontal: 6, marginTop: 8, borderTopWidth: 1, borderTopColor: C.line }}>
          {([['scheduled', 'Scheduled'], ['progress', 'In progress'], ['done', 'Completed']] as const).map(([k, l]) => (
            <Text key={k} style={{ color: C.soft, fontSize: 12 }}><Text style={{ color: EV_COLOR[k], fontWeight: '800' }}>ST </Text>{l}</Text>
          ))}
          <Text style={{ color: C.soft, fontSize: 12 }}><Text style={{ color: '#B98CFF' }}>● </Text>Holiday</Text>
          <Text style={{ color: C.soft, fontSize: 12 }}><Text style={{ color: '#5FA8FF' }}>💧 </Text>Rain {RAIN_HIGH}%+</Text>
        </View>
      </Card>

      <Card style={{ marginTop: 8 }}>
        <Text style={[s.ttl, { paddingTop: 12, paddingBottom: 4 }]}>{selDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        {si.hol && <AgendaLine k="Holiday" v={`${si.hol} — expect closures`} color="#D5BEFF" />}
        {si.weekend && !si.hol && <AgendaLine k="Weekend" v="No scheduled service" />}
        <AgendaLine k="Chance of rain" v={si.rain == null ? 'No forecast yet' : `${si.rain}%${si.rainy ? ' — outdoor work at risk' : ''}`} color={si.rainy ? '#7DB8FF' : undefined} />
        {sev.map((e) => (
          <Pressable key={e.act + e.kind} onPress={() => router.push(`/activity/${e.act}`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: EV_COLOR[e.kind] }} />
            <Text style={[s.text, { flex: 1 }]}>{e.text}</Text>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        ))}
        {!sev.length && <AgendaLine k="Repair activity" v="Nothing planned" last />}
      </Card>

      <Reminders vehicles={vehicles} intervals={intervals} acts={acts} />
    </View>
  );
}

function Reminders({ vehicles, intervals, acts }: { vehicles: Vehicle[]; intervals: ServiceInterval[]; acts: RepairActivity[] }) {
  const fc: Forecast[] = forecasts(vehicles, intervals, acts);
  const deferredLoose = acts.filter((a) => a.status === 'deferred' && !a.interval_id);
  if (!fc.length && !deferredLoose.length) return null;
  const nOver = fc.filter((f) => f.due.over).length;
  return (
    <Card style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12 }}>
        <Text style={s.ttl}>Reminders</Text>
        <Text style={s.small}>{nOver ? `${nOver} overdue · ` : ''}{fc.length - nOver} coming due</Text>
      </View>
      <Text style={[s.small, { paddingBottom: 4 }]}>Not scheduled yet — tap one to schedule it.</Text>
      {fc.map((f) => {
        const col = f.due.over ? '#FF6B6B' : '#F6C46A';
        return (
          <Pressable key={f.interval.id} onPress={() => router.push(`/interval/${f.interval.id}`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <Text style={{ color: col, fontWeight: '800', width: 36 }}>{f.vehicle.unit_number}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: '600' }]}>{f.interval.task}</Text>
              <Text style={{ color: col, fontSize: 13 }}>
                {f.deferred ? `Deferred (${f.deferred.deferred_reason}) · ` : ''}
                {f.due.over ? `Overdue — ${f.due.lead}` : `Projected due ~${dateLabel(iso(projectedDate(f.vehicle, f.interval)))} · ${f.due.lead}`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        );
      })}
      {deferredLoose.map((a) => (
        <Pressable key={a.id} onPress={() => router.push(`/activity/${a.id}`)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <Text style={{ color: '#F6C46A', fontWeight: '800', width: 36 }}>{vehicles.find((v) => v.id === a.vehicle_id)?.unit_number}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.text, { fontWeight: '600' }]}>{a.title}</Text>
            <Text style={{ color: '#F6C46A', fontSize: 13 }}>Deferred: {a.deferred_reason}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.muted} />
        </Pressable>
      ))}
    </Card>
  );
}

function AgendaLine({ k, v, color, last }: { k: string; v: string; color?: string; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, minHeight: 44, alignItems: 'center', borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line }}>
      <Text style={{ color: color ?? C.muted, fontSize: 15 }}>{k}</Text>
      <Text style={{ color: color ?? C.text, fontWeight: '600', fontSize: 15, flexShrink: 1, textAlign: 'right' }}>{v}</Text>
    </View>
  );
}

function NavBtn({ icon, label, onPress, disabled }: { icon: 'chevron-back' | 'chevron-forward'; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label}
      style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line2, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
      <Ionicons name={icon} size={22} color={C.text} />
    </Pressable>
  );
}
