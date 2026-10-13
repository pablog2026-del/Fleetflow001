import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Chips, Field, Header, Loading, Note, Screen, Section } from '../../components/ui';
import { say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/format';
import { must, rpc, supabase } from '../../lib/supabase';
import type { Vehicle } from '../../lib/types';
import { useData } from '../../lib/useData';

const ISSUES = ['Warning light', 'Hoist / hydraulics', 'Brakes / air', 'Tires', 'Scheduled PM', 'Vehicle inspection', 'Monthly inspection', 'Other'] as const;
const URGENCY = ['Truck down', 'This week', 'Next PM'] as const;

export default function Request() {
  const { fleet } = useAuth();
  const params = useLocalSearchParams<{ unit?: string }>();
  const [unit, setUnit] = useState<string>('');
  const [issue, setIssue] = useState<(typeof ISSUES)[number]>('Warning light');
  const [urg, setUrg] = useState<(typeof URGENCY)[number]>('This week');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useData(async () =>
    must(await supabase.from('vehicles').select('*').eq('fleet_org_id', fleet!.id).order('unit_number')) as Vehicle[], [fleet?.id]);
  useEffect(() => { if (params.unit) setUnit(params.unit); }, [params.unit]);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const chosen = data.find((v) => v.id === unit) ?? data[0];
  if (!chosen) return <Loading error="Add a truck first." />;

  const send = async () => {
    setBusy(true);
    try {
      const id = await rpc<number>('request_service', { p_vehicle: chosen.id, p_issue: issue, p_urgency: urg, p_description: text.trim() || null });
      setText('');
      router.push(`/activity/${id}`);
    } catch (e) { say('Could not send', errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Screen edges={['top']}>
      <Header title="Request service" />
      <Section style={{ marginTop: 6 }}>
        <Text style={{ color: '#C9CED6', fontWeight: '600', marginBottom: 8 }}>Truck</Text>
        <Chips options={data.map((v) => `Unit ${v.unit_number}`)} value={`Unit ${chosen.unit_number}`}
          onChange={(l) => setUnit(data.find((v) => `Unit ${v.unit_number}` === l)!.id)} />
      </Section>
      <Section>
        <Text style={{ color: '#C9CED6', fontWeight: '600', marginBottom: 8 }}>What’s going on?</Text>
        <Chips options={ISSUES} value={issue} onChange={setIssue} />
      </Section>
      <Section>
        <Text style={{ color: '#C9CED6', fontWeight: '600', marginBottom: 8 }}>How urgent?</Text>
        <Chips options={URGENCY} value={urg} onChange={setUrg} />
        {urg === 'Truck down' && (
          <View style={{ marginTop: 10 }}>
            <Button title="Broken down on the road? Use the breakdown path" kind="danger" icon="warning-outline" onPress={() => router.push(`/breakdown?unit=${chosen.id}`)} />
          </View>
        )}
      </Section>
      <Section style={{ marginTop: 0 }}>
        <Field label="Describe it" value={text} onChangeText={setText} multiline placeholder="What’s the driver seeing or hearing?" />
        <View style={{ marginTop: 20 }}><Button title="Send request" kind="primary" onPress={send} busy={busy} /></View>
        <Note style={{ textAlign: 'center' }}>This opens a repair activity. You’ll get an estimate to approve.</Note>
      </Section>
    </Screen>
  );
}
