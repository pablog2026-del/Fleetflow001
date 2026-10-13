// Repair activity: timeline, estimate, owner approval (approve / decline / defer),
// breakdown response tracking, and — for Admin acting as the provider in stage
// one — send estimate, start work, complete & invoice.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, ScrollView, Text, View } from 'react-native';
import { Button, Card, Field, KV, Loading, Note, Pill, Screen, Section, s } from '../../components/ui';
import { ask, say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { fetchRain, nextWorkDay } from '../../lib/calendar';
import { exportPdf, serviceReportHtml } from '../../lib/export';
import { signedUrls } from '../../lib/fleet';
import { dateLabel, errorMessage, isoDate, money, num } from '../../lib/format';
import { STATUS } from '../../lib/schedule';
import { must, rpc, supabase } from '../../lib/supabase';
import { C } from '../../lib/theme';
import type { ActivityEvent, Breakdown, DocumentRow, EstimateLine, Inspection, Invoice, Organization, RepairActivity, Vehicle } from '../../lib/types';
import { useData } from '../../lib/useData';

const hrsBetween = (a?: string | null, b?: string | null) =>
  a && b ? `${((new Date(b).getTime() - new Date(a).getTime()) / 3_600_000).toFixed(1)} hrs` : '—';

export default function ActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const [mode, setMode] = useState<'none' | 'decline' | 'defer' | 'complete'>('none');
  const [reason, setReason] = useState('');
  const [meter, setMeter] = useState({ miles: '', hours: '', notes: '' });
  const [busy, setBusy] = useState(false);

  const { data, error, reload } = useData(async () => {
    const a = must(await supabase.from('repair_activities').select('*').eq('id', id).single()) as RepairActivity;
    const [v, org, provider, events, lines, bd, invoice, docs] = await Promise.all([
      supabase.from('vehicles').select('*').eq('id', a.vehicle_id).single().then(must),
      supabase.from('organizations').select('*').eq('id', a.fleet_org_id).single().then(must),
      a.provider_org_id ? supabase.from('organizations').select('name').eq('id', a.provider_org_id).maybeSingle().then(must) : null,
      supabase.from('activity_events').select('*').eq('activity_id', id).order('created_at').then(must),
      supabase.from('estimate_lines').select('*').eq('activity_id', id).order('position').then(must),
      supabase.from('breakdowns').select('*').eq('activity_id', id).maybeSingle().then(must),
      supabase.from('invoices').select('*').eq('activity_id', id).neq('status', 'void').maybeSingle().then(must),
      supabase.from('documents').select('*').eq('activity_id', id).then(must),
    ]);
    const inspections = must(await supabase.from('inspections').select('*').eq('activity_id', id).order('id', { ascending: false })) as Inspection[];
    const origin = must(await supabase.from('inspections').select('*').eq('defects_activity_id', id).maybeSingle()) as Inspection | null;
    const typeName = a.inspection_type_key
      ? (must(await supabase.from('inspection_types').select('name').eq('key', a.inspection_type_key).single()) as { name: string }).name : null;
    return { a, v: v as Vehicle, org: org as Organization, provider: provider as { name: string } | null, events: events as ActivityEvent[],
      lines: lines as EstimateLine[], bd: bd as Breakdown | null, invoice: invoice as Invoice | null, docs: docs as DocumentRow[],
      urls: await signedUrls(docs as DocumentRow[]), inspection: inspections[0] ?? null, origin, typeName };
  }, [id]);
  if (!data) return <Loading error={error} onRetry={reload} />;

  const { a, v, org, provider, events, lines, bd, invoice, docs, urls, inspection, origin, typeName } = data;

  const openInspection = async () => {
    setBusy(true);
    try { router.push(`/inspection/${await rpc<number>('start_inspection', { p_activity: a.id })}`); reload(); }
    catch (e) { say('Could not start inspection', errorMessage(e)); } finally { setBusy(false); }
  };
  const st = STATUS[a.status];
  const total = lines.reduce((t, l) => t + Number(l.amount), 0);
  const providerName = provider?.name ?? 'Your provider';

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); setMode('none'); setReason(''); reload(); if (done) say(done); }
    catch (e) { say('Something went wrong', errorMessage(e)); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    let date: string | null = null;
    if (a.kind !== 'breakdown') {
      const rain = await fetchRain(org.latitude ?? undefined, org.longitude ?? undefined);
      const from = new Date(); from.setDate(from.getDate() + 1);
      const nw = nextWorkDay(from, rain);
      date = isoDate(nw.day);
      const ok = await ask(`Approve ${money(total)}?`, `Scheduled for ${dateLabel(date)}, 7:00 AM at your yard.${nw.skipped.length ? `\nSkipped ${nw.skipped.join('; ')}.` : ''}`, 'Approve');
      if (!ok) return;
    }
    act(() => rpc('approve_estimate', { p_activity: a.id, p_date: date }), a.kind === 'breakdown' ? 'Approved — tech dispatched.' : `Approved. RA #${a.id} is scheduled.`);
  };

  const report = () => exportPdf(`Service report RA #${a.id}`, serviceReportHtml({ fleet: org.name, unit: v.unit_number, vin: v.vin, id: a.id,
    title: a.title, completed: a.completed_at, miles: a.completed_miles, lines: lines.map((l) => ({ description: l.description, amount: l.amount })), events }));

  return (
    <Screen onRefresh={reload}>
      <View style={{ padding: 16, gap: 4 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pill label={st.label} tone={st.tone} />
          {a.kind === 'breakdown' && <Pill label="Breakdown" tone="red" />}
        </View>
        <Text style={s.h1}>Repair activity #{a.id}</Text>
        <Text style={{ color: C.soft }}>Unit {v.unit_number} · {v.make} · {a.title}</Text>
        {a.description ? <Text style={[s.small, { marginTop: 4 }]}>Note: “{a.description}”</Text> : null}
        {a.status === 'deferred' && <Text style={[s.small, { color: '#F6C46A' }]}>Deferred: {a.deferred_reason}{a.deferred_until ? ` · until ${dateLabel(a.deferred_until)}` : ''}</Text>}
        {a.status === 'declined' && a.declined_reason && <Text style={[s.small, { color: '#FF9A9A' }]}>Declined: {a.declined_reason}</Text>}
      </View>

      {typeName && (
        <Section title={typeName}>
          <Card>
            <KV k="Checklist" v={inspection ? (inspection.status === 'completed' ? (inspection.passed ? 'Passed' : 'Defects found') : 'In progress') : 'Not started'}
              color={inspection?.status === 'completed' ? (inspection.passed ? '#7FD9B0' : '#FF9A9A') : undefined} />
            <KV k="Inspection" v={inspection ? `#${inspection.id}${inspection.completed_at ? ' · ' + dateLabel(inspection.completed_at) : ''}` : '—'} last />
          </Card>
          <View style={{ gap: 8, marginTop: 8 }}>
            {inspection && <Button title={inspection.status === 'completed' ? 'View inspection report' : isAdmin ? 'Continue checklist' : 'View checklist progress'}
              kind={isAdmin && inspection.status !== 'completed' ? 'primary' : 'default'} icon="clipboard-outline" onPress={() => router.push(`/inspection/${inspection.id}`)} />}
            {isAdmin && !inspection && ['scheduled', 'progress'].includes(a.status) && (
              <Button title="Start inspection checklist" kind="primary" icon="clipboard-outline" busy={busy} onPress={openInspection} />
            )}
            {inspection?.defects_activity_id && <Button title={`Defect repairs · RA #${inspection.defects_activity_id}`} onPress={() => router.push(`/activity/${inspection.defects_activity_id}`)} />}
          </View>
        </Section>
      )}
      {origin && (
        <Section style={{ marginTop: 6 }}>
          <Button title={`Found in inspection #${origin.id}`} kind="ghost" icon="clipboard-outline" onPress={() => router.push(`/inspection/${origin.id}`)} />
        </Section>
      )}

      {bd && (
        <Section title="Roadside">
          <Card>
            <KV k="Symptoms" v={bd.symptoms} />
            <KV k="Location" v={bd.location_text ?? (bd.latitude ? `${bd.latitude.toFixed(4)}, ${bd.longitude?.toFixed(4)}` : '—')} />
            <KV k="Driveable" v={bd.driveable ? 'Yes' : 'No'} />
            <KV k="Tow" v={bd.needs_tow ? (bd.tow_arrived_at ? `Arrived ${new Date(bd.tow_arrived_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Requested') : 'Not needed'} />
            <KV k="Response time" v={hrsBetween(bd.reported_at, bd.responded_at)} />
            <KV k="Tech on site after" v={hrsBetween(bd.reported_at, bd.tech_arrived_at)} />
            <KV k="Downtime" v={hrsBetween(bd.reported_at, bd.resolved_at ?? (a.status === 'done' ? a.completed_at : new Date().toISOString()))} last />
          </Card>
          {bd.latitude != null && (
            <Button title="Open in Maps" kind="ghost" icon="navigate-outline" style={{ marginTop: 8 }}
              onPress={() => Linking.openURL(`https://maps.google.com/?q=${bd.latitude},${bd.longitude}`)} />
          )}
          {isAdmin && !bd.resolved_at && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {!bd.responded_at && <Button title="Mark responded" style={{ flexGrow: 1 }} onPress={() => act(() => rpc('update_breakdown', { p_activity: a.id, p: { responded: true } }))} />}
              {bd.needs_tow && !bd.tow_arrived_at && <Button title="Tow arrived" style={{ flexGrow: 1 }} onPress={() => act(() => rpc('update_breakdown', { p_activity: a.id, p: { tow_arrived: true } }))} />}
              {!bd.tech_arrived_at && <Button title="Tech on site" style={{ flexGrow: 1 }} onPress={() => act(() => rpc('update_breakdown', { p_activity: a.id, p: { tech_arrived: true } }))} />}
            </View>
          )}
        </Section>
      )}

      {docs.length > 0 && (
        <Section title="Photos">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {docs.filter((d) => d.storage_path && urls[d.storage_path]).map((d) => (
              <Image key={d.id} source={{ uri: urls[d.storage_path!] }} style={{ width: 160, height: 120, borderRadius: 10, marginRight: 8 }} accessibilityLabel={d.title} />
            ))}
          </ScrollView>
        </Section>
      )}

      <Section style={{ marginTop: 6 }}>
        <Card pad={false} style={{ padding: 16 }}>
          {events.map((h, i) => {
            const last = i === events.length - 1;
            return (
              <View key={h.id} style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ alignItems: 'center', width: 16 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, marginTop: 4, backgroundColor: last && a.status !== 'done' ? C.amber : '#7FD9B0' }} />
                  {!last && <View style={{ width: 2, flex: 1, backgroundColor: C.line2, marginVertical: 4 }} />}
                </View>
                <View style={{ paddingBottom: last ? 0 : 12, flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: '600' }}>{h.text}</Text>
                  <Text style={s.small}>{new Date(h.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
                </View>
              </View>
            );
          })}
        </Card>
      </Section>

      {a.status === 'requested' ? (
        <Section>
          {isAdmin ? <Button title="Send estimate" kind="primary" onPress={() => router.push(`/estimate/${a.id}`)} />
            : <Card pad={false} style={{ padding: 18 }}><Text style={{ color: C.soft, textAlign: 'center' }}>{providerName} will inspect and send an estimate for your approval.</Text></Card>}
        </Section>
      ) : (
        <>
          <Section title="Service team">
            <Card><KV k="Repair provider" v={providerName} /><KV k="Labor rate" v={a.labor_rate ? `${money(a.labor_rate)}/hr · OEM book time` : '—'} last /></Card>
          </Section>
          <Section title={a.status === 'estimate' || a.status === 'deferred' ? 'Estimate' : a.status === 'done' ? 'Final cost' : 'Approved estimate'}>
            <Card>
              {lines.map((l) => (
                <KV key={l.id} k={l.kind === 'labor' ? 'Labor' : l.kind === 'part' ? 'Parts' : l.kind === 'fee' ? 'Fee' : 'Sublet'}
                  sub={l.kind === 'labor' ? `${l.description} · ${l.book_hours ?? l.quantity} hrs book × ${money(l.unit_price)}/hr`
                    : `${l.description}${l.part_number ? ` · #${l.part_number}` : ''}${l.kind === 'part' ? ' · at cost' : ''}${Number(l.quantity) !== 1 ? ` · qty ${l.quantity}` : ''}`}
                  v={money(l.amount)} />
              ))}
              <KV k="Total" v={money(total)} strong last />
            </Card>
            <Note>No parts markup. Labor from the OEM book-time guide.</Note>
          </Section>
        </>
      )}

      {/* owner decisions */}
      {(a.status === 'estimate' || a.status === 'deferred') && !isAdmin && mode === 'none' && (
        <Section style={{ gap: 10 }}>
          <Button title={`Approve ${money(total)}`} kind="primary" onPress={approve} busy={busy} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {a.status === 'estimate' && <Button title="Defer" onPress={() => setMode('defer')} style={{ flex: 1 }} />}
            <Button title="Decline" kind="ghost" onPress={() => setMode('decline')} style={{ flex: 1 }} />
          </View>
        </Section>
      )}
      {(mode === 'decline' || mode === 'defer') && (
        <Section title={mode === 'defer' ? 'Defer this repair' : 'Decline this estimate'}>
          <Field label={mode === 'defer' ? 'Reason (required — goes in the DOT file)' : 'Reason (optional)'} value={reason} onChangeText={setReason} multiline />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button title="Cancel" kind="ghost" onPress={() => setMode('none')} style={{ flex: 1 }} />
            <Button title={mode === 'defer' ? 'Defer' : 'Decline'} kind="primary" busy={busy} style={{ flex: 1.4 }}
              onPress={() => mode === 'defer'
                ? act(() => rpc('defer_activity', { p_activity: a.id, p_reason: reason.trim() }), 'Deferred. It stays on your reminders.')
                : act(() => rpc('decline_estimate', { p_activity: a.id, p_reason: reason.trim() || null }))} />
          </View>
        </Section>
      )}

      {/* provider (Admin in stage one) */}
      {isAdmin && mode === 'none' && (
        <Section style={{ gap: 10 }}>
          {['estimate', 'deferred'].includes(a.status) && <Button title="Revise estimate" onPress={() => router.push(`/estimate/${a.id}`)} />}
          {a.status === 'estimate' && <Note>Waiting for {org.name} to approve.</Note>}
          {a.status === 'scheduled' && !typeName && <Button title="Start work" kind="primary" busy={busy} onPress={() => act(() => rpc('start_work', { p_activity: a.id }))} />}
          {['scheduled', 'progress'].includes(a.status) && !typeName && <Button title="Complete & send report" kind={a.status === 'progress' ? 'primary' : 'default'}
            onPress={() => { setMeter({ miles: String(Math.round(v.odometer_miles)), hours: String(Math.round(v.engine_hours)), notes: '' }); setMode('complete'); }} />}
        </Section>
      )}
      {mode === 'complete' && (
        <Section title="Complete repair activity">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="Odometer (mi)" value={meter.miles} onChangeText={(t) => setMeter({ ...meter, miles: t })} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><Field label="Engine hours" value={meter.hours} onChangeText={(t) => setMeter({ ...meter, hours: t })} keyboardType="number-pad" /></View>
          </View>
          <Field label="Notes for the report" value={meter.notes} onChangeText={(t) => setMeter({ ...meter, notes: t })} multiline />
          <Note>Completing creates the invoice from the approved estimate and resets the OEM interval at these meter readings.</Note>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button title="Cancel" kind="ghost" onPress={() => setMode('none')} style={{ flex: 1 }} />
            <Button title="Complete" kind="primary" busy={busy} style={{ flex: 1.4 }}
              onPress={() => act(() => rpc('complete_activity', { p_activity: a.id, p_miles: Number(meter.miles) || null,
                p_hours: Number(meter.hours) || null, p_notes: meter.notes.trim() || null }), `RA #${a.id} completed and invoiced.`)} />
          </View>
        </Section>
      )}

      {a.status === 'done' && (
        <Section style={{ gap: 10 }}>
          <Button title="Download service report" icon="document-text-outline" onPress={() => report().catch((e) => say('Export failed', errorMessage(e)))} />
          {invoice && <Button title={`Invoice ${invoice.number} · ${money(invoice.total)}`} onPress={() => router.push(`/invoice/${invoice.id}`)} />}
          {a.completed_miles != null && <Note>Completed {dateLabel(a.completed_at)} at {num(a.completed_miles)} mi.</Note>}
        </Section>
      )}
    </Screen>
  );
}
