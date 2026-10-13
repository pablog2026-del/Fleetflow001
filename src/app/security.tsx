// TOTP two-factor enrollment (Supabase Auth MFA).
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Button, Card, Field, KV, Loading, Note, Screen, Section, s } from '../components/ui';
import { say } from '../lib/alert';
import { errorMessage } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/useData';

export default function Security() {
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const { data, error, reload } = useData(async () => {
    const { data: f, error: e } = await supabase.auth.mfa.listFactors();
    if (e) throw e;
    return f.totp;
  });
  if (!data) return <Loading error={error} onRetry={reload} />;
  const verified = data.filter((f) => f.status === 'verified');

  const start = async () => {
    try {
      const { data: d, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${Date.now()}` });
      if (e) throw e;
      setEnroll({ id: d.id, qr: d.totp.qr_code, secret: d.totp.secret });
    } catch (e) { say('Could not start', errorMessage(e)); }
  };
  const verify = async () => {
    try {
      const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll!.id, code: code.trim() });
      if (e) throw e;
      setEnroll(null); setCode(''); reload(); say('Two-factor is on');
    } catch (e) { say('Code didn’t match', errorMessage(e)); }
  };
  const remove = async (id: string) => {
    const { error: e } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (e) say('Could not remove', e.message); else reload();
  };

  return (
    <Screen>
      <Section>
        <Card>
          <KV k="Two-factor authentication" v={verified.length ? 'On' : 'Off'} last />
        </Card>
        <Note>Use an authenticator app (1Password, Google Authenticator, Authy). Required for Admin accounts.</Note>
      </Section>
      {verified.map((f) => (
        <Section key={f.id}><Button title={`Remove ${f.friendly_name ?? 'authenticator'}`} kind="ghost" onPress={() => remove(f.id)} /></Section>
      ))}
      {enroll ? (
        <Section title="Scan this code">
          <View style={{ alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 12 }}>
            <Image source={{ uri: enroll.qr }} style={{ width: 200, height: 200 }} accessibilityLabel="Authenticator QR code" />
          </View>
          <Text style={[s.small, { marginTop: 8 }]} selectable>Or enter this key: {enroll.secret}</Text>
          <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
          <Button title="Verify" kind="primary" onPress={verify} style={{ marginTop: 12 }} />
        </Section>
      ) : !verified.length && (
        <Section><Button title="Set up two-factor" kind="primary" onPress={start} /></Section>
      )}
    </Screen>
  );
}
