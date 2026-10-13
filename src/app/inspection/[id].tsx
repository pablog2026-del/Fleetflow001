// Perform an inspection checklist (Admin acting as the provider in stage one) or read
// the completed report. Each answer saves immediately, so a checklist can be resumed.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, Field, KV, Loading, Note, Pill, Screen, Section, Seg, s } from '../../components/ui';
import { ask, say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { checklistHtml, exportPdf } from '../../lib/export';
import { errorMessage, longDate, num } from '../../lib/format';
import { must, rpc, supabase } from '../../lib/supabase';
import { C, TONES } from '../../lib/theme';
import type { Inspection, InspectionItem, InspectionResult, InspectionResultValue, InspectionType, Vehicle } from '../../lib/types';
import { useData } from '../../lib/useData';

const CHOICES: { v: InspectionResultValue; label: string; tone: keyof typeof TONES }[] = [
  { v: 'pass', label: 'OK', tone: 'grn' },
  { v: 'fail', label: 'Defect', tone: 'red' },
  { v: 'repaired', label: 'Repaired', tone: 'blue' },
  { v: 'na', label: 'N/A', tone: 'grey' },
];
const FILTERS = ['All', 'To do', 'Defects'] as const;

export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAdmin, session } = useAuth();
  const [answers, setAnswers] = useState<Record<string, InspectionResult>>({});
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [finish, setFinish] = useState({ miles: '', hours: '', inspector: '', notes: '' });
  const [busy, setBusy] = useState(false);

  const { data, error, reload } = useData(async () => {
    const ins = must(await supabase.from('inspections').select('*').eq('id', id).single()) as Inspection;
    const [type, items, results, v, fleet] = await Promise.all([
      supabase.from('inspection_types').select('*').eq('key', ins.type_key).single().then(must),
      supabase.from('inspection_items').select('*').eq('type_key', ins.type_key).eq('active', true).order('section_position').order('position').then(must),
      supabase.from('inspection_results').select('*').eq('inspection_id', id).then(must),
      supabase.from('vehicles').select('*').eq('id', ins.vehicle_id).single().then(must),
      supabase.from('organizations').select('name').eq('id', ins.fleet_org_id).single().then(must),
    ]);
    return { ins, type: type as InspectionType, items: items as InspectionItem[], results: results as InspectionResult[],
      v: v as Vehicle, fleet: (fleet as { name: string }).name };
  }, [id]);

  useEffect(() => {
    if (!data) return;
    setAnswers(Object.fromEntries(data.results.map((r) => [r.item_id, r])));
    setFinish((f) => ({ miles: f.miles || String(Math.round(data.v.odometer_miles)), hours: f.hours || String(Math.round(data.v.engine_hours)),
      inspector: f.inspector || data.ins.inspector_name || (session?.user.user_metadata?.full_name as string) || '', notes: f.notes }));
  }, [data]);
  if (!data) return <Loading error={error} onRetry={reload} />;

  const { ins, type, items, v, fleet } = data;
  const editable = isAdmin && ins.status === 'in_progress';
  const answered = items.filter((i) => answers[i.id]).length;
  const defects = items.filter((i) => answers[i.id]?.result === 'fail');
  const sections = [...new Set(items.map((i) => i.section))];
  const shown = (i: InspectionItem) => filter === 'All' || (filter === 'To do' ? !answers[i.id] : answers[i.id]?.result === 'fail');

  const save = async (item: InspectionItem, patch: Partial<InspectionResult>) => {
    const prev = answers[item.id];
    const next = { inspection_id: ins.id, item_id: item.id, result: prev?.result ?? 'pass', measurement: prev?.measurement ?? null,
      note: prev?.note ?? null, ...patch } as InspectionResult;
    setAnswers((a) => ({ ...a, [item.id]: next }));
    if (next.result === 'fail' && !next.note?.trim()) return; // saved once the defect is described
    try {
      await rpc('record_inspection_item', { p_inspection: ins.id, p_item: item.id, p_result: next.result,
        p_measurement: next.measurement, p_note: next.note });
    } catch (e) { say('Not saved', errorMessage(e)); }
  };

  const complete = async () => {
    const missing = items.filter((i) => !answers[i.id]).length;
    if (missing) { setFilter('To do'); return say(`${missing} item${missing > 1 ? 's' : ''} left`, 'Every item needs a result before the inspection can be completed.'); }
    const unsaved = defects.filter((i) => !answers[i.id]?.note?.trim());
    if (unsaved.length) { setFilter('Defects'); return say('Describe each defect', 'A failed item needs a short description of what is wrong.'); }
    const unmeasured = items.filter((i) => i.measure_unit && ['pass', 'fail'].includes(answers[i.id]?.result ?? '') && !answers[i.id]?.measurement?.trim());
    if (unmeasured.length) return say('Readings missing', unmeasured.map((i) => `${i.section}: ${i.label}`).join('\n'));
    const critical = defects.some((i) => i.critical);
    const msg = defects.length
      ? `${defects.length} defect${defects.length > 1 ? 's' : ''} found. A defects repair activity opens for an estimate and the owner's approval.${critical ? ' The truck stays OUT OF SERVICE until repaired.' : ''}`
      : 'All items meet the standard. The inspection passes.';
    if (!(await ask(`Complete ${type.name.toLowerCase()}?`, msg, 'Complete'))) return;
    setBusy(true);
    try {
      await rpc('complete_inspection', { p_inspection: ins.id, p_miles: Number(finish.miles) || null, p_hours: Number(finish.hours) || null,
        p_inspector: finish.inspector.trim() || null, p_notes: finish.notes.trim() || null });
      reload();
    } catch (e) { say('Could not complete', errorMessage(e)); } finally { setBusy(false); }
  };

  const pdf = () => exportPdf(`${type.name} #${ins.id}`, checklistHtml(type, items, {
    inspection: ins, results: Object.values(answers), fleet,
    vehicle: { unit: v.unit_number, vin: v.vin, year: v.year, make: v.make, model: v.model },
  })).catch((e) => say('Export failed', errorMessage(e)));

  return (
    <Screen onRefresh={reload}>
      <View style={{ padding: 16, gap: 4 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {ins.status === 'completed'
            ? <Pill label={ins.passed ? 'Passed' : 'Failed'} tone={ins.passed ? 'grn' : 'red'} />
            : <Pill label="In progress" tone="blue" />}
          <Pill label={`${answered}/${items.length} checked`} />
          {defects.length > 0 && <Pill label={`${defects.length} defect${defects.length > 1 ? 's' : ''}`} tone="red" />}
        </View>
        <Text style={s.h1}>{type.name} #{ins.id}</Text>
        <Text style={{ color: C.soft }}>Unit {v.unit_number} · {[v.year, v.make, v.model].filter(Boolean).join(' ')} · {fleet}</Text>
        <Text style={s.small}>{type.regulation}</Text>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden', marginTop: 8 }}>
          <View style={{ width: `${(answered / Math.max(items.length, 1)) * 100}%`, height: 6, backgroundColor: defects.length ? '#FF6B6B' : '#4CC38A' }} />
        </View>
      </View>

      {ins.status === 'completed' && (
        <Section style={{ marginTop: 0 }}>
          <Card>
            <KV k="Completed" v={longDate(ins.completed_at)} />
            <KV k="Odometer" v={ins.odometer_miles != null ? `${num(ins.odometer_miles)} mi` : '—'} />
            <KV k="Engine hours" v={ins.engine_hours != null ? num(ins.engine_hours) : '—'} />
            <KV k="Inspector" v={ins.inspector_name ?? '—'} last={!ins.notes} />
            {ins.notes && <KV k="Notes" v={ins.notes} last />}
          </Card>
          <View style={{ gap: 8, marginTop: 10 }}>
            {ins.defects_activity_id && <Button title={`Defect repairs · RA #${ins.defects_activity_id}`} kind="primary" onPress={() => router.push(`/activity/${ins.defects_activity_id}`)} />}
            <Button title="Inspection report (PDF)" icon="document-text-outline" onPress={pdf} />
          </View>
        </Section>
      )}

      <Section>
        <Seg options={FILTERS} value={filter} onChange={setFilter}
          counts={{ All: items.length, 'To do': items.length - answered, Defects: defects.length }} />
        {editable && <Note>Tap a result for each item. Mark “Repaired” when a defect is fixed on the spot; “Defect” opens it for an estimate. ● = out-of-service item.</Note>}
      </Section>

      {sections.map((sec) => {
        const list = items.filter((i) => i.section === sec && shown(i));
        if (!list.length) return null;
        const done = items.filter((i) => i.section === sec && answers[i.id]).length;
        const total = items.filter((i) => i.section === sec).length;
        return (
          <Section key={sec} title={sec} right={<Text style={s.small}>{done}/{total}</Text>}>
            {list.map((i) => {
              const a = answers[i.id];
              return (
                <Card key={i.id} pad={false} style={{ padding: 14, marginBottom: 8, borderColor: a?.result === 'fail' ? TONES.red.ln : C.line }}>
                  <Text style={s.ttl}>{i.critical ? <Text style={{ color: '#FF6B6B' }}>● </Text> : null}{i.label}</Text>
                  {i.guidance ? <Text style={[s.meta, { marginTop: 2 }]}>{i.guidance}</Text> : null}
                  {i.reference ? <Text style={s.small}>{i.reference}</Text> : null}
                  {editable ? (
                    <>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
                        {CHOICES.map((c) => {
                          const on = a?.result === c.v;
                          return (
                            <Pressable key={c.v} onPress={() => save(i, { result: c.v })} accessibilityRole="radio" accessibilityState={{ selected: on }}
                              accessibilityLabel={`${i.label}: ${c.label}`}
                              style={{ flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                                borderColor: on ? TONES[c.tone].fg : C.line2, backgroundColor: on ? TONES[c.tone].bg : 'transparent' }}>
                              <Text style={{ color: on ? TONES[c.tone].fg : C.soft, fontWeight: '700' }}>{c.label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {i.measure_unit && a && a.result !== 'na' && (
                        <Field label={`Reading (${i.measure_unit})`} defaultValue={a?.measurement ?? ''} keyboardType={i.measure_unit === 'codes' ? 'default' : 'decimal-pad'}
                          onEndEditing={(e) => a && save(i, { measurement: e.nativeEvent.text })}
                          onBlur={(e) => { const t = (e.target as unknown as { value?: string })?.value; if (a && t !== undefined) save(i, { measurement: t }); }} />
                      )}
                      {(a?.result === 'fail' || a?.result === 'repaired') && (
                        <Field label={a.result === 'fail' ? 'Defect (required)' : 'What was fixed'} defaultValue={a.note ?? ''} multiline
                          onEndEditing={(e) => save(i, { note: e.nativeEvent.text })}
                          onBlur={(e) => { const t = (e.target as unknown as { value?: string })?.value; if (t !== undefined) save(i, { note: t }); }} />
                      )}
                    </>
                  ) : (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
                      <Text style={[s.meta, { flexShrink: 1 }]}>{[a?.measurement && `${a.measurement} ${i.measure_unit ?? ''}`, a?.note].filter(Boolean).join(' · ')}</Text>
                      {a ? <Pill label={CHOICES.find((c) => c.v === a.result)!.label} tone={CHOICES.find((c) => c.v === a.result)!.tone as 'grn'} /> : <Pill label="Not checked" />}
                    </View>
                  )}
                </Card>
              );
            })}
          </Section>
        );
      })}

      {editable && (
        <Section title="Finish">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="Odometer (mi)" value={finish.miles} onChangeText={(t) => setFinish({ ...finish, miles: t })} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><Field label="Engine hours" value={finish.hours} onChangeText={(t) => setFinish({ ...finish, hours: t })} keyboardType="number-pad" /></View>
          </View>
          <Field label="Inspector name" value={finish.inspector} onChangeText={(t) => setFinish({ ...finish, inspector: t })}
            hint={type.key === 'annual' ? 'Must be qualified under 49 CFR 396.19.' : undefined} />
          <Field label="Notes" value={finish.notes} onChangeText={(t) => setFinish({ ...finish, notes: t })} multiline />
          <Button title={`Complete inspection · ${answered}/${items.length}`} kind="primary" onPress={complete} busy={busy} style={{ marginTop: 14 }} />
          <Button title="Blank checklist (PDF)" kind="ghost" onPress={() => exportPdf(type.name, checklistHtml(type, items, { fleet,
            vehicle: { unit: v.unit_number, vin: v.vin, year: v.year, make: v.make, model: v.model } })).catch((e) => say('Export failed', errorMessage(e)))} style={{ marginTop: 8 }} />
        </Section>
      )}
    </Screen>
  );
}
