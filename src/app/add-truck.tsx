// Add a truck by VIN: validate the check digit, decode with NHTSA vPIC, then build a
// draft OEM schedule from the template library. Drafts go live after Admin confirms them.
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Field, KV, Note, Screen, Section, s } from '../components/ui';
import { say } from '../lib/alert';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/format';
import { must, rpc, supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { useFleetId } from '../lib/useFleetId';
import { decodeVin, normalizeVin, vinProblem, type DecodedVin } from '../lib/vin';

export default function AddTruck() {
  const fleetId = useFleetId();
  const { isAdmin } = useAuth();
  const [vin, setVin] = useState('');
  const [dec, setDec] = useState<DecodedVin | null>(null);
  const [f, setF] = useState({ unit_number: '', odometer_miles: '', engine_hours: '', avg_miles_per_day: '150', driver_name: '', plate: '', model: '' });
  const [busy, setBusy] = useState(false);
  const problem = vin.length >= 17 ? vinProblem(vin) : null;

  const lookup = async () => {
    const p = vinProblem(vin);
    if (p) return say('Check the VIN', p);
    setBusy(true);
    try {
      const d = await decodeVin(vin);
      setDec(d);
      setF((x) => ({ ...x, model: d.model ?? '' }));
    } catch (e) { say('VIN lookup failed', `${errorMessage(e)}\nYou can still add the truck and fill details in later.`); setDec(null); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!fleetId) return;
    if (!f.unit_number.trim()) return say('Give the truck a unit number', 'e.g. ST7');
    const p = vinProblem(vin);
    if (p) return say('Check the VIN', p);
    setBusy(true);
    try {
      const v = must(await supabase.from('vehicles').insert({
        fleet_org_id: fleetId, unit_number: f.unit_number.trim().toUpperCase(), vin: normalizeVin(vin),
        year: dec?.year ?? null, make: dec?.make ?? null, model: f.model.trim() || dec?.model || null, body_type: dec?.body_type ?? null,
        engine: dec?.engine ?? null, transmission: dec?.transmission ?? null, gvwr: dec?.gvwr ?? null,
        odometer_miles: Number(f.odometer_miles) || 0, engine_hours: Number(f.engine_hours) || 0,
        avg_miles_per_day: Number(f.avg_miles_per_day) || 150, driver_name: f.driver_name.trim() || null,
        plate: f.plate.trim().toUpperCase() || null, plate_state: f.plate ? 'NC' : null, vin_decoded: dec?.raw ?? null,
      }).select('id').single()) as { id: string };
      if (Number(f.odometer_miles) || Number(f.engine_hours)) {
        await rpc('record_meter', { p_vehicle: v.id, p_miles: Number(f.odometer_miles) || null, p_hours: Number(f.engine_hours) || null, p_source: 'manual' });
      }
      const n = await rpc<number>('apply_interval_templates', { p_vehicle: v.id });
      say('Truck added', `${n} OEM service interval${n === 1 ? '' : 's'} drafted. ${isAdmin ? 'Review and confirm them before they go live.' : 'Northgate reviews each one before it goes live.'}`);
      router.replace(`/unit/${v.id}`);
    } catch (e) { say('Could not add truck', errorMessage(e)); } finally { setBusy(false); }
  };

  const set = (k: keyof typeof f) => (t: string) => setF({ ...f, [k]: t });
  return (
    <Screen>
      <Section style={{ marginTop: 8 }}>
        <Text style={s.sub}>Enter the 17-character VIN from the data plate or registration. We decode it with NHTSA and draft the OEM service schedule.</Text>
        <Field label="VIN" value={vin} onChangeText={(t) => { setVin(normalizeVin(t)); setDec(null); }} autoCapitalize="characters" maxLength={17}
          autoCorrect={false} hint={problem ?? `${normalizeVin(vin).length}/17`} />
        <Button title="Decode VIN" icon="search" onPress={lookup} busy={busy} disabled={normalizeVin(vin).length !== 17} style={{ marginTop: 10 }} />
      </Section>

      {dec && (
        <Section title="Decoded (NHTSA)">
          <Card>
            <KV k="Year / make" v={[dec.year, dec.make].filter(Boolean).join(' ') || '—'} />
            <KV k="Model" v={dec.model ?? '—'} />
            <KV k="Body" v={dec.body_type ?? '—'} />
            <KV k="Engine" v={dec.engine ?? '—'} />
            <KV k="Transmission" v={dec.transmission ?? '—'} />
            <KV k="GVWR" v={dec.gvwr ?? '—'} last />
          </Card>
          {dec.warning && <Note style={{ color: '#F6C46A' }}>NHTSA note: {dec.warning}</Note>}
          <Note>The data plate wins in a conflict — fix anything that doesn’t match it.</Note>
        </Section>
      )}

      <Section title="Truck details">
        <Field label="Unit number" value={f.unit_number} onChangeText={set('unit_number')} autoCapitalize="characters" placeholder="ST7" />
        <Field label="Model (if NHTSA left it blank)" value={f.model} onChangeText={set('model')} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Field label="Odometer (mi)" value={f.odometer_miles} onChangeText={set('odometer_miles')} keyboardType="number-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Engine hours" value={f.engine_hours} onChangeText={set('engine_hours')} keyboardType="number-pad" /></View>
        </View>
        <Field label="Average miles per day" value={f.avg_miles_per_day} onChangeText={set('avg_miles_per_day')} keyboardType="number-pad" hint="Used to project due dates until telematics is connected." />
        <Field label="Assigned driver" value={f.driver_name} onChangeText={set('driver_name')} />
        <Field label="Plate (NC)" value={f.plate} onChangeText={set('plate')} autoCapitalize="characters" />
        <View style={{ marginTop: 20 }}><Button title="Add truck" kind="primary" onPress={save} busy={busy} /></View>
        <Note style={{ color: C.muted }}>Service intervals start as drafts. {isAdmin ? 'Confirm each one against the OEM manual.' : 'Northgate confirms each one against the OEM manual before reminders start.'}</Note>
      </Section>
    </Screen>
  );
}
