// Unit detail: photos, vehicle info, driver, meter, OEM schedule, resources,
// repairs by category, repair history, DOT file.
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { ItemRow } from '../../components/rows';
import { Button, Card, Empty, Field, KV, Loading, Pill, Row, Screen, Section, Seg, s } from '../../components/ui';
import { ask, say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { dotFileHtml, exportPdf } from '../../lib/export';
import { loadFleet, signedUrls, uploadDocument } from '../../lib/fleet';
import { errorMessage, longDate, money0, num } from '../../lib/format';
import { byCat, CATS, due, truckStatus } from '../../lib/schedule';
import { must, rpc, supabase } from '../../lib/supabase';
import { C } from '../../lib/theme';
import type { DocumentRow, DotFile, Inspection, InspectionType, Vehicle } from '../../lib/types';
import { useData } from '../../lib/useData';

export default function Unit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, isAdmin } = useAuth();
  const [tab, setTab] = useState<(typeof CATS)[number]>('Ongoing');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ driver_name: '', plate: '', plate_state: '', miles: '', hours: '' });
  const [busy, setBusy] = useState(false);

  const { data, error, reload } = useData(async () => {
    const v = must(await supabase.from('vehicles').select('*').eq('id', id).single()) as Vehicle;
    const fleet = await loadFleet(v.fleet_org_id);
    const docs = must(await supabase.from('documents').select('*').eq('vehicle_id', id).order('created_at', { ascending: false })) as DocumentRow[];
    const spent = must(await supabase.from('invoices').select('total').eq('vehicle_id', id).eq('kind', 'service').neq('status', 'void'))
      .reduce((a: number, r: { total: number }) => a + Number(r.total), 0);
    const [inspections, types] = await Promise.all([
      supabase.from('inspections').select('*').eq('vehicle_id', id).order('started_at', { ascending: false }).limit(20).then(must),
      supabase.from('inspection_types').select('*').order('position').then(must),
    ]);
    return { ...fleet, v: fleet.vehicles.find((x) => x.id === id)!, docs, urls: await signedUrls(docs), spent,
      inspections: inspections as Inspection[], types: types as InspectionType[] };
  }, [id]);
  if (!data) return <Loading error={error} onRetry={reload} />;

  const { v, intervals, acts, docs, urls, spent, org, inspections, types } = data;
  const mine = intervals.filter((i) => i.vehicle_id === v.id);
  const st = truckStatus(v, intervals, acts);
  const g = byCat([v], mine, acts.filter((a) => a.vehicle_id === v.id));
  const photos = docs.filter((d) => ['photo', 'data_plate'].includes(d.kind) && d.storage_path && urls[d.storage_path]);
  const resources = docs.filter((d) => !['photo', 'data_plate'].includes(d.kind));
  const sources = mine.filter((i) => i.source_url);
  const sched = [...mine].sort((a, b) => due(v, a).rank - due(v, b).rank);

  const startEdit = () => {
    setForm({ driver_name: v.driver_name ?? '', plate: v.plate ?? '', plate_state: v.plate_state ?? 'NC',
      miles: String(Math.round(v.odometer_miles)), hours: String(Math.round(v.engine_hours)) });
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      must(await supabase.from('vehicles').update({ driver_name: form.driver_name || null, plate: form.plate || null,
        plate_state: form.plate_state || null }).eq('id', v.id));
      const miles = Number(form.miles), hours = Number(form.hours);
      if (miles !== Math.round(v.odometer_miles) || hours !== Math.round(v.engine_hours)) {
        await rpc('record_meter', { p_vehicle: v.id, p_miles: miles || null, p_hours: hours || null, p_source: 'manual' });
      }
      setEditing(false);
      reload();
    } catch (e) { say('Could not save', errorMessage(e)); } finally { setBusy(false); }
  };

  const addPhoto = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    if (camera) {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return say('Camera permission is needed');
    }
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled) return;
    try {
      await uploadDocument({ orgId: v.fleet_org_id, vehicleId: v.id, uri: r.assets[0].uri, kind: 'photo',
        title: `Unit ${v.unit_number} photo`, contentType: r.assets[0].mimeType ?? 'image/jpeg', userId: session!.user.id });
      reload();
    } catch (e) { say('Upload failed', errorMessage(e)); }
  };

  const dot = async () => {
    try { await exportPdf(`DOT file Unit ${v.unit_number}`, dotFileHtml(await rpc<DotFile>('dot_file', { p_vehicle: v.id }))); }
    catch (e) { say('Could not build DOT file', errorMessage(e)); }
  };

  const remove = async () => {
    if (!(await ask('Remove truck?', `Unit ${v.unit_number} and all its records will be deleted.`, 'Delete', true))) return;
    try { must(await supabase.from('vehicles').delete().eq('id', v.id)); router.back(); }
    catch (e) { say('Could not delete', errorMessage(e)); }
  };

  return (
    <Screen onRefresh={reload}>
      <Section style={{ marginTop: 8 }}>
        <Card pad={false} style={{ overflow: 'hidden' }}>
          {photos.length ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ backgroundColor: C.panel2 }}>
              {photos.map((p) => <Image key={p.id} source={{ uri: urls[p.storage_path!] }} accessibilityLabel={p.title}
                style={{ width: 340, height: 200, marginRight: 4 }} resizeMode="cover" />)}
            </ScrollView>
          ) : (
            <View style={{ height: 120, backgroundColor: C.panel2, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={s.small}>No photos yet</Text>
            </View>
          )}
          <View style={{ padding: 14, gap: 6 }}>
            <Text style={s.h1}>Unit {v.unit_number}</Text>
            <Text style={{ color: C.soft, fontSize: 16 }}>{[v.year, v.make, v.model].filter(Boolean).join(' ')}{v.body_type ? ` · ${v.body_type}` : ''}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pill label={st.label} tone={st.tone} />
              <Pill label={v.in_service ? 'In service' : 'Out of service'} tone={v.in_service ? 'grn' : 'red'} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <Button title="Take photo" icon="camera-outline" onPress={() => addPhoto(true)} style={{ flex: 1, minHeight: 42 }} />
              <Button title="Upload" icon="image-outline" onPress={() => addPhoto(false)} style={{ flex: 1, minHeight: 42 }} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line }}>
            {[['Miles', num(v.odometer_miles)], ['Engine hrs', num(v.engine_hours)], ['Spent', money0(spent)]].map(([k, val], i) => (
              <View key={k} style={{ flex: 1, padding: 12, borderRightWidth: i < 2 ? 1 : 0, borderRightColor: C.line }}>
                <Text style={s.small}>{k}</Text>
                <Text style={{ color: C.text, fontWeight: '800', fontSize: 20 }}>{val}</Text>
              </View>
            ))}
          </View>
        </Card>
      </Section>

      <Section title="Vehicle information" right={!editing && <Pressable onPress={startEdit}><Text style={{ color: C.amber, fontWeight: '700' }}>Edit</Text></Pressable>}>
        {editing ? (
          <Card pad={false} style={{ padding: 14 }}>
            <Field label="Assigned driver" value={form.driver_name} onChangeText={(t) => setForm({ ...form, driver_name: t })} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 2 }}><Field label="Plate" value={form.plate} onChangeText={(t) => setForm({ ...form, plate: t })} autoCapitalize="characters" /></View>
              <View style={{ flex: 1 }}><Field label="State" value={form.plate_state} onChangeText={(t) => setForm({ ...form, plate_state: t })} autoCapitalize="characters" maxLength={2} /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Field label="Odometer (mi)" value={form.miles} onChangeText={(t) => setForm({ ...form, miles: t })} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><Field label="Engine hours" value={form.hours} onChangeText={(t) => setForm({ ...form, hours: t })} keyboardType="number-pad" /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Button title="Cancel" kind="ghost" onPress={() => setEditing(false)} style={{ flex: 1 }} />
              <Button title="Save" kind="primary" onPress={save} busy={busy} style={{ flex: 1.4 }} />
            </View>
          </Card>
        ) : (
          <Card>
            <KV k="VIN" v={v.vin} />
            <KV k="Plate" v={v.plate ? `${v.plate} · ${v.plate_state ?? ''}` : '—'} />
            <KV k="Driver" v={v.driver_name ?? '—'} />
            <KV k="Engine" v={v.engine ?? '—'} />
            <KV k="Transmission" v={v.transmission ?? '—'} />
            <KV k="GVWR" v={v.gvwr ?? '—'} last />
          </Card>
        )}
      </Section>

      <Section title="OEM service schedule">
        <Card>
          {sched.length ? sched.map((it, i) => {
            const d = due(v, it);
            const color = it.status === 'draft' ? C.muted : d.over ? '#FF9A9A' : d.soon ? '#F6C46A' : C.soft;
            const every = [it.every_miles && `${num(it.every_miles)} mi`, it.every_hours && `${num(it.every_hours)} hrs`, it.every_days && `${it.every_days} days`].filter(Boolean).join(' / ');
            return (
              <Pressable key={it.id} onPress={() => router.push(`/interval/${it.id}`)}>
                <KV k={it.task} sub={`every ${every}${it.status === 'draft' ? ' · pending review' : ''}`}
                  v={<Text style={{ color, fontWeight: '600' }}>{it.status === 'draft' ? 'Pending review' : d.lead}</Text>} last={i === sched.length - 1} />
              </Pressable>
            );
          }) : <KV k="No intervals yet" v="" last />}
        </Card>
        {isAdmin && mine.some((i) => i.status === 'draft') && (
          <Button title="Review & confirm intervals" onPress={() => router.push(`/review/${v.fleet_org_id}`)} style={{ marginTop: 8 }} />
        )}
      </Section>

      <Section title="Inspections" right={<Pressable onPress={() => router.push('/checklists')}><Text style={{ color: C.amber, fontWeight: '700' }}>Checklists</Text></Pressable>}>
        <Card>
          {types.map((t, n) => {
            const it = mine.find((i) => i.inspection_type_key === t.key && i.status === 'confirmed');
            const last = inspections.find((x) => x.type_key === t.key && x.status === 'completed');
            const d = it ? due(v, it) : null;
            return (
              <Pressable key={t.key} onPress={() => it ? router.push(`/interval/${it.id}`) : undefined}>
                <KV k={t.name} sub={last ? `Last: ${longDate(last.completed_at)} · ${last.passed ? 'passed' : 'defects found'}` : 'No inspection on file'}
                  v={<Text style={{ color: !d ? C.muted : d.over ? '#FF9A9A' : d.soon ? '#F6C46A' : C.soft, fontWeight: '600' }}>{d ? (d.over ? `Overdue · ${d.lead}` : `Due ${d.lead}`) : 'Not scheduled'}</Text>}
                  last={n === types.length - 1 && !inspections.length} />
              </Pressable>
            );
          })}
          {inspections.slice(0, 6).map((x, n, arr) => (
            <Pressable key={x.id} onPress={() => router.push(`/inspection/${x.id}`)}>
              <KV k={`#${x.id} · ${types.find((t) => t.key === x.type_key)?.name ?? x.type_key}`}
                sub={x.completed_at ? longDate(x.completed_at) : `Started ${longDate(x.started_at)}`}
                v={<Pill label={x.status === 'in_progress' ? 'In progress' : x.passed ? 'Passed' : 'Failed'} tone={x.status === 'in_progress' ? 'blue' : x.passed ? 'grn' : 'red'} />}
                last={n === arr.length - 1} />
            </Pressable>
          ))}
        </Card>
      </Section>

      <Section title="Resources">
        <Card>
          {resources.map((d) => (
            <Pressable key={d.id} onPress={() => d.url ? Linking.openURL(d.url) : d.storage_path && Linking.openURL(urls[d.storage_path])}>
              <KV k={d.title} v={d.kind} />
            </Pressable>
          ))}
          {sources.map((i) => (
            <Pressable key={i.id} onPress={() => Linking.openURL(i.source_url!)}>
              <KV k={`OEM source · ${i.task}`} v={i.source_ref ?? 'Open'} />
            </Pressable>
          ))}
          <Pressable onPress={dot}><KV k="DOT-ready file (PDF)" v="Export" last /></Pressable>
        </Card>
      </Section>

      <Section title="Repairs">
        <Seg options={CATS} value={tab} onChange={setTab} counts={Object.fromEntries(CATS.map((k) => [k, g[k].length]))} />
        <View style={{ marginTop: 10 }}>
          {g[tab].length ? g[tab].map((x, i) => <ItemRow key={i} x={x} vehicles={[v]} />) : <Empty>No {tab.toLowerCase()} repair activities on this unit.</Empty>}
        </View>
        <Row title="Repair history" meta={`${g.History.length} past repair activities`} icon="time-outline"
          onPress={() => router.push(`/history?unit=${v.id}&fleet=${org.id}`)} />
      </Section>

      <Section style={{ gap: 10 }}>
        {!isAdmin && <Button title="Request service" kind="primary" icon="add" onPress={() => router.push(`/(owner)/request?unit=${v.id}`)} />}
        {!isAdmin && <Button title="Report a breakdown" kind="danger" icon="warning-outline" onPress={() => router.push(`/breakdown?unit=${v.id}`)} />}
        {isAdmin && <Button title="Delete truck" kind="ghost" onPress={remove} />}
      </Section>
    </Screen>
  );
}
