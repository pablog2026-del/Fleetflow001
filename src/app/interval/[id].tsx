// One OEM schedule item: interval, where the truck is, estimated cost, and the
// owner's choices — schedule it (around weekends, holidays and rain) or defer it with a reason.
// Admin can edit and confirm a draft here.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Button, Card, Chips, Field, KV, Loading, Note, Pill, Screen, Section, s } from '../../components/ui';
import { say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { fetchRain, nextWorkDay, type RainMap } from '../../lib/calendar';
import { dateLabel, errorMessage, isoDate, money, num } from '../../lib/format';
import { due, isOpen } from '../../lib/schedule';
import { must, rpc, supabase } from '../../lib/supabase';
import { C } from '../../lib/theme';
import type { Organization, RepairActivity, ServiceInterval, Vehicle } from '../../lib/types';
import { useData } from '../../lib/useData';

export default function IntervalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const [rain, setRain] = useState<RainMap>({});
  const [mode, setMode] = useState<'none' | 'schedule' | 'defer' | 'edit'>('none');
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Record<string, string>>({});

  const { data, error, reload } = useData(async () => {
    const it = must(await supabase.from('service_intervals').select('*').eq('id', id).single()) as ServiceInterval;
    const v = must(await supabase.from('vehicles').select('*').eq('id', it.vehicle_id).single()) as Vehicle;
    const acts = must(await supabase.from('repair_activities').select('*').eq('interval_id', id).order('id', { ascending: false })) as RepairActivity[];
    const org = must(await supabase.from('organizations').select('*').eq('id', v.fleet_org_id).single()) as Organization;
    const provider = must(await supabase.from('organizations').select('labor_rate').eq('type', 'provider').limit(1)) as { labor_rate: number | null }[];
    const settings = must(await supabase.from('platform_settings').select('default_labor_rate').maybeSingle()) as { default_labor_rate: number } | null;
    return { it, v, acts, org, rate: Number(provider[0]?.labor_rate ?? settings?.default_labor_rate ?? 150) };
  }, [id]);
  useEffect(() => { if (data) fetchRain(data.org.latitude ?? undefined, data.org.longitude ?? undefined).then(setRain); }, [data?.org.id]);
  if (!data) return <Loading error={error} onRetry={reload} />;

  const { it, v, acts, rate } = data;
  const d = due(v, it);
  const open = acts.find(isOpen);
  const deferred = acts.find((a) => a.status === 'deferred');
  const labor = Number(it.book_hours) * rate;
  const cost = labor + Number(it.est_parts_cost);

  // next 5 workable days, skipping weekends, holidays and 60%+ rain
  const options: { label: string; date: string; skipped: string[] }[] = [];
  let from = new Date(); from.setDate(from.getDate() + 1);
  for (let i = 0; i < 5; i++) {
    const nw = nextWorkDay(from, rain);
    options.push({ label: nw.day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), date: isoDate(nw.day), skipped: nw.skipped });
    from = new Date(nw.day); from.setDate(from.getDate() + 1);
  }
  const chosen = options.find((o) => o.label === pick) ?? options[0];

  const schedule = async () => {
    setBusy(true);
    try {
      const ra = await rpc<number>('schedule_interval', { p_interval: it.id, p_date: chosen.date });
      router.replace(`/activity/${ra}`);
    } catch (e) { say('Could not schedule', errorMessage(e)); } finally { setBusy(false); }
  };
  const defer = async () => {
    if (!reason.trim()) return say('Add a reason', 'Deferrals keep a reason on file — it appears in the DOT file.');
    setBusy(true);
    try {
      await rpc('defer_interval', { p_interval: it.id, p_reason: reason.trim(), p_until: until || null });
      setMode('none'); setReason(''); reload();
    } catch (e) { say('Could not defer', errorMessage(e)); } finally { setBusy(false); }
  };
  const startEdit = () => {
    setEdit({ task: it.task, every_miles: String(it.every_miles ?? ''), every_hours: String(it.every_hours ?? ''), every_days: String(it.every_days ?? ''),
      book_hours: String(it.book_hours), est_parts_cost: String(it.est_parts_cost), last_done_miles: String(Math.round(it.last_done_miles)),
      last_done_hours: String(Math.round(it.last_done_hours)), source_ref: it.source_ref ?? '', source_url: it.source_url ?? '' });
    setMode('edit');
  };
  const saveEdit = async (confirm: boolean) => {
    setBusy(true);
    const n = (x: string) => (x.trim() === '' ? null : Number(x));
    try {
      must(await supabase.from('service_intervals').update({ task: edit.task, every_miles: n(edit.every_miles), every_hours: n(edit.every_hours),
        every_days: n(edit.every_days), book_hours: n(edit.book_hours) ?? 1, est_parts_cost: n(edit.est_parts_cost) ?? 0,
        last_done_miles: n(edit.last_done_miles) ?? 0, last_done_hours: n(edit.last_done_hours) ?? 0,
        source_ref: edit.source_ref || null, source_url: edit.source_url || null }).eq('id', it.id));
      if (confirm) await rpc('confirm_intervals', { p_ids: [it.id] });
      setMode('none'); reload();
    } catch (e) { say('Could not save', errorMessage(e)); } finally { setBusy(false); }
  };

  const tone = it.status === 'draft' ? 'grey' : d.over ? 'red' : d.soon ? 'amb' : 'grn';
  return (
    <Screen>
      <View style={{ padding: 16, gap: 4 }}>
        <Pill label={it.status === 'draft' ? 'Pending review' : deferred ? 'Deferred' : d.over ? 'Overdue' : d.soon ? 'Due soon' : 'On schedule'} tone={tone} />
        <Text style={s.h1}>{it.task}</Text>
        <Text style={{ color: C.soft }}>Unit {v.unit_number} · {v.year} {v.make} · {it.component_category}</Text>
        {!open && <Text style={s.small}>No repair activity number yet — one is created when you schedule it.</Text>}
      </View>

      {mode === 'edit' ? (
        <Section title="Edit interval">
          <Card pad={false} style={{ padding: 14 }}>
            <Field label="Task" value={edit.task} onChangeText={(t) => setEdit({ ...edit, task: t })} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Field label="Every miles" value={edit.every_miles} onChangeText={(t) => setEdit({ ...edit, every_miles: t })} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><Field label="Every eng hrs" value={edit.every_hours} onChangeText={(t) => setEdit({ ...edit, every_hours: t })} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><Field label="Every days" value={edit.every_days} onChangeText={(t) => setEdit({ ...edit, every_days: t })} keyboardType="number-pad" /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Field label="Book hours" value={edit.book_hours} onChangeText={(t) => setEdit({ ...edit, book_hours: t })} keyboardType="decimal-pad" /></View>
              <View style={{ flex: 1 }}><Field label="Est. parts $" value={edit.est_parts_cost} onChangeText={(t) => setEdit({ ...edit, est_parts_cost: t })} keyboardType="decimal-pad" /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Field label="Last done (mi)" value={edit.last_done_miles} onChangeText={(t) => setEdit({ ...edit, last_done_miles: t })} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><Field label="Last done (hrs)" value={edit.last_done_hours} onChangeText={(t) => setEdit({ ...edit, last_done_hours: t })} keyboardType="number-pad" /></View>
            </View>
            <Field label="OEM source (manual & section)" value={edit.source_ref} onChangeText={(t) => setEdit({ ...edit, source_ref: t })} />
            <Field label="Source link" value={edit.source_url} onChangeText={(t) => setEdit({ ...edit, source_url: t })} autoCapitalize="none" />
            <View style={{ gap: 8, marginTop: 14 }}>
              {it.status === 'draft' && isAdmin && <Button title="Save & confirm" kind="primary" onPress={() => saveEdit(true)} busy={busy} />}
              <Button title="Save" onPress={() => saveEdit(false)} busy={busy} />
              <Button title="Cancel" kind="ghost" onPress={() => setMode('none')} />
            </View>
          </Card>
        </Section>
      ) : (
        <>
          <Section title="OEM interval">
            <Card>
              <KV k="Every" v={[it.every_miles && `${num(it.every_miles)} mi`, it.every_hours && `${num(it.every_hours)} engine hrs`, it.every_days && `${it.every_days} days`].filter(Boolean).join(' or ')} />
              <KV k="Last done" v={`${num(it.last_done_miles)} mi${it.every_hours ? ` · ${num(it.last_done_hours)} hrs` : ''}${it.last_done_on ? ` · ${dateLabel(it.last_done_on)}` : ''}`} />
              <KV k="Truck now" v={`${num(v.odometer_miles)} mi · ${num(v.engine_hours)} hrs`} />
              {it.every_miles != null && <KV k="Miles left" v={d.mi < 0 ? `${num(-d.mi)} over` : num(d.mi)} color={d.mi < 0 ? '#FF9A9A' : d.mi <= 1500 ? '#F6C46A' : undefined} />}
              {it.every_hours != null && <KV k="Engine hrs left" v={d.hrs < 0 ? `${num(-d.hrs)} over` : num(d.hrs)} color={d.hrs < 0 ? '#FF9A9A' : d.hrs <= 75 ? '#F6C46A' : undefined} />}
              {it.every_days != null && <KV k="Days left" v={d.days < 0 ? `${num(-d.days)} over` : num(d.days)} color={d.days < 0 ? '#FF9A9A' : undefined} />}
              <KV k="Source" v={it.source_ref ?? '—'} last />
            </Card>
            <Note>Due at whichever comes first — {d.by === 'hours' ? 'engine hours' : d.by === 'days' ? 'time' : 'miles'} will hit first.</Note>
            {it.source_url && <Button title="Open OEM source" kind="ghost" onPress={() => Linking.openURL(it.source_url!)} style={{ marginTop: 8 }} />}
          </Section>

          <Section title="Estimated cost">
            <Card>
              <KV k="Labor" sub={`${it.book_hours} hrs book time × ${money(rate)}/hr`} v={money(labor)} />
              <KV k="Parts" sub={`${it.component_category} · billed at cost`} v={money(it.est_parts_cost)} />
              <KV k="Total" v={money(cost)} strong last />
            </Card>
          </Section>
        </>
      )}

      {deferred && (
        <Section title="Deferred">
          <Card><KV k="Reason" v={deferred.deferred_reason ?? ''} /><KV k="Until" v={deferred.deferred_until ? dateLabel(deferred.deferred_until) : '—'} last /></Card>
          <Note>Stays on your reminders and in the truck’s DOT file until it’s done.</Note>
        </Section>
      )}

      {open ? (
        <Section><Button title={`View repair activity #${open.id}`} onPress={() => router.push(`/activity/${open.id}`)} /></Section>
      ) : it.status === 'confirmed' && !isAdmin && mode === 'none' ? (
        <Section style={{ gap: 10 }}>
          <Button title={`Schedule · ${money(cost)}`} kind="primary" onPress={() => setMode('schedule')} />
          {!deferred && <Button title="Defer with a reason" onPress={() => setMode('defer')} />}
        </Section>
      ) : null}

      {mode === 'schedule' && (
        <Section title="Pick a day">
          <Chips options={options.map((o) => o.label)} value={chosen.label} onChange={setPick} />
          {chosen.skipped.length > 0 && <Note>Skipped {chosen.skipped.join('; ')}.</Note>}
          <Note>Scheduling approves the OEM estimate above. 7:00 AM at your yard.</Note>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button title="Cancel" kind="ghost" onPress={() => setMode('none')} style={{ flex: 1 }} />
            <Button title="Schedule" kind="primary" onPress={schedule} busy={busy} style={{ flex: 1.4 }} />
          </View>
        </Section>
      )}
      {mode === 'defer' && (
        <Section title="Defer this item">
          <Field label="Reason (required)" value={reason} onChangeText={setReason} multiline placeholder="e.g. truck sold next month; waiting for slow season" />
          <Field label="Remind me after (optional, YYYY-MM-DD)" value={until} onChangeText={setUntil} placeholder="2026-12-01" />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button title="Cancel" kind="ghost" onPress={() => setMode('none')} style={{ flex: 1 }} />
            <Button title="Defer" kind="primary" onPress={defer} busy={busy} style={{ flex: 1.4 }} />
          </View>
        </Section>
      )}
      {isAdmin && mode === 'none' && (
        <Section style={{ gap: 10 }}>
          {it.status === 'draft' && <Button title="Confirm interval" kind="primary" onPress={async () => {
            try { await rpc('confirm_intervals', { p_ids: [it.id] }); reload(); } catch (e) { say('Could not confirm', errorMessage(e)); }
          }} />}
          <Button title="Edit interval" onPress={startEdit} />
        </Section>
      )}
    </Screen>
  );
}
