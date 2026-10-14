// Door 2, step 2: the new owner creates their company (pending / trial until Admin approves).
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { say } from '../lib/alert';
import { Button, Field, Screen, s } from '../components/ui';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/format';
import { rpc } from '../lib/supabase';

export default function Onboarding() {
  const { refresh, signOut, session, fleet, isAdmin } = useAuth();
  const [f, setF] = useState({ name: '', address_line1: '', city: '', state: 'NC', postal_code: '', phone: '', usdot_number: '',
    primary_contact_name: (session?.user.user_metadata?.full_name as string) ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  if (fleet || isAdmin) return <Redirect href="/" />;

  const save = async () => {
    if (!f.name.trim()) return say('Company name is required');
    setBusy(true);
    try {
      await rpc('self_signup_create_fleet', { p: f });
      await refresh();
      router.replace('/add-truck');
    } catch (e) {
      say('Could not create your account', errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <View style={{ padding: 20 }}>
        <Text style={s.sub}>Tell us about your company. You can start adding trucks right away; Northgate approves new accounts and reviews every OEM interval before it goes live.</Text>
        <Field label="Company name" value={f.name} onChangeText={set('name')} />
        <Field label="Street address" value={f.address_line1} onChangeText={set('address_line1')} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 2 }}><Field label="City" value={f.city} onChangeText={set('city')} /></View>
          <View style={{ flex: 1 }}><Field label="State" value={f.state} onChangeText={set('state')} autoCapitalize="characters" maxLength={2} /></View>
          <View style={{ flex: 1.4 }}><Field label="ZIP" value={f.postal_code} onChangeText={set('postal_code')} keyboardType="number-pad" /></View>
        </View>
        <Field label="Phone" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label="USDOT number" value={f.usdot_number} onChangeText={set('usdot_number')} keyboardType="number-pad" />
        <Field label="Primary contact" value={f.primary_contact_name} onChangeText={set('primary_contact_name')} />
        <View style={{ marginTop: 20, gap: 10 }}>
          <Button title="Create company" kind="primary" onPress={save} busy={busy} />
          <Button title="Sign out" kind="ghost" onPress={signOut} />
        </View>
      </View>
    </Screen>
  );
}
