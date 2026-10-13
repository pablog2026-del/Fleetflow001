// Roadside / emergency: location, symptoms, photos, driveable or tow. Creates an
// urgent repair activity that skips the scheduler and pages the provider (push + SMS).
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { Button, Card, Chips, Field, KV, Loading, Note, Screen, Section, s } from '../components/ui';
import { say } from '../lib/alert';
import { useAuth } from '../lib/auth';
import { uploadDocument } from '../lib/fleet';
import { errorMessage } from '../lib/format';
import { must, rpc, supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import type { Vehicle } from '../lib/types';
import { useData } from '../lib/useData';

const STATE = ['Driveable', 'Not driveable', 'Needs a tow'] as const;

export default function BreakdownScreen() {
  const { fleet, session } = useAuth();
  const params = useLocalSearchParams<{ unit?: string }>();
  const [unit, setUnit] = useState('');
  const [state, setState] = useState<(typeof STATE)[number]>('Not driveable');
  const [symptoms, setSymptoms] = useState('');
  const [where, setWhere] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useData(async () =>
    must(await supabase.from('vehicles').select('*').eq('fleet_org_id', fleet!.id).order('unit_number')) as Vehicle[], [fleet?.id]);
  useEffect(() => { if (params.unit) setUnit(params.unit); }, [params.unit]);

  const locate = async () => {
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted) return say('Location permission is needed', 'Or type where the truck is.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      try {
        const [r] = await Location.reverseGeocodeAsync(pos.coords);
        if (r && !where) setWhere([r.name ?? r.street, r.city, r.region].filter(Boolean).join(', '));
      } catch { /* reverse geocoding is best-effort */ }
    } catch (e) { say('Could not get location', errorMessage(e)); }
  };
  useEffect(() => { locate(); }, []);

  const addPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    const r = perm.granted
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
    if (!r.canceled) setPhotos([...photos, ...r.assets]);
  };

  if (!data) return <Loading error={error} onRetry={reload} />;
  const chosen = data.find((v) => v.id === unit) ?? data[0];
  if (!chosen) return <Loading error="Add a truck first." />;

  const send = async () => {
    if (!symptoms.trim()) return say('Describe what happened', 'A few words help the tech bring the right parts.');
    setBusy(true);
    try {
      const id = await rpc<number>('report_breakdown', {
        p_vehicle: chosen.id, p_symptoms: symptoms.trim(), p_driveable: state === 'Driveable', p_needs_tow: state === 'Needs a tow',
        p_latitude: coords?.lat ?? null, p_longitude: coords?.lon ?? null, p_location_text: where.trim() || null,
      });
      for (const p of photos) {
        await uploadDocument({ orgId: chosen.fleet_org_id, vehicleId: chosen.id, activityId: id, uri: p.uri, kind: 'photo',
          title: `Breakdown RA #${id}`, contentType: p.mimeType ?? 'image/jpeg', userId: session!.user.id }).catch(() => {});
      }
      router.replace(`/activity/${id}`);
      say('Help is on the way', 'Your provider has been paged. You’ll get an estimate to approve.');
    } catch (e) { say('Could not send', errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <View style={{ padding: 16 }}>
        <Text style={[s.h1, { color: '#FF9A9A' }]}>Truck broken down</Text>
        <Text style={s.sub}>This pages your provider right away and skips the scheduler.</Text>
      </View>
      <Section style={{ marginTop: 0 }}>
        <Chips options={data.map((v) => `Unit ${v.unit_number}`)} value={`Unit ${chosen.unit_number}`}
          onChange={(l) => setUnit(data.find((v) => `Unit ${v.unit_number}` === l)!.id)} />
      </Section>
      <Section title="Can it move?"><Chips options={STATE} value={state} onChange={setState} /></Section>
      <Section style={{ marginTop: 6 }}>
        <Field label="Symptoms" value={symptoms} onChangeText={setSymptoms} multiline placeholder="e.g. air pressure dropping, warning light, smoke, leak" />
        <Field label="Where is it?" value={where} onChangeText={setWhere} placeholder="Road, exit, landmark" />
        <Card style={{ marginTop: 10 }}>
          <KV k="GPS" v={coords ? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}` : 'Not shared'} last />
        </Card>
        <Button title={coords ? 'Update location' : 'Share my location'} kind="ghost" icon="locate-outline" onPress={locate} style={{ marginTop: 8 }} />
      </Section>
      <Section title="Photos">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {photos.map((p) => <Image key={p.uri} source={{ uri: p.uri }} style={{ width: 110, height: 90, borderRadius: 10, marginRight: 8 }} />)}
        </ScrollView>
        <Button title="Add photo" icon="camera-outline" onPress={addPhoto} style={{ marginTop: 8 }} />
      </Section>
      <Section>
        <Button title="Send breakdown" kind="primary" icon="warning" onPress={send} busy={busy} />
        <Note style={{ textAlign: 'center', color: C.muted }}>Downtime and response time are tracked from now.</Note>
      </Section>
    </Screen>
  );
}
