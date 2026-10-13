// Door 1, step 2: Admin creates the company shell.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Note, Screen, Section } from '../components/ui';
import { say } from '../lib/alert';
import { errorMessage } from '../lib/format';
import { rpc } from '../lib/supabase';

export default function NewCustomer() {
  const [f, setF] = useState({ name: '', account_number: '', address_line1: '', city: 'Raleigh', state: 'NC', postal_code: '', phone: '',
    email: '', usdot_number: '', primary_contact_name: '', primary_contact_title: '', billing_contact: '', service_location: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (t: string) => setF({ ...f, [k]: t });
  const save = async () => {
    if (!f.name.trim()) return say('Company name is required');
    setBusy(true);
    try {
      const id = await rpc<string>('admin_create_customer', { p: f });
      router.replace(`/customer/${id}`);
    } catch (e) { say('Could not create customer', errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Section style={{ marginTop: 6 }}>
        <Field label="Company name" value={f.name} onChangeText={set('name')} placeholder="Shells Trucking" />
        <Field label="Account number" value={f.account_number} onChangeText={set('account_number')} placeholder="002" keyboardType="number-pad" />
        <Field label="Street address" value={f.address_line1} onChangeText={set('address_line1')} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 2 }}><Field label="City" value={f.city} onChangeText={set('city')} /></View>
          <View style={{ flex: 1 }}><Field label="State" value={f.state} onChangeText={set('state')} maxLength={2} autoCapitalize="characters" /></View>
          <View style={{ flex: 1.4 }}><Field label="ZIP" value={f.postal_code} onChangeText={set('postal_code')} /></View>
        </View>
        <Field label="Phone" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label="Email" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" />
        <Field label="USDOT number" value={f.usdot_number} onChangeText={set('usdot_number')} />
        <Field label="Primary contact" value={f.primary_contact_name} onChangeText={set('primary_contact_name')} />
        <Field label="Contact title" value={f.primary_contact_title} onChangeText={set('primary_contact_title')} />
        <Field label="Billing contact" value={f.billing_contact} onChangeText={set('billing_contact')} />
        <Field label="Service location" value={f.service_location} onChangeText={set('service_location')} placeholder="Customer yard — address" />
        <View style={{ marginTop: 20 }}><Button title="Create customer" kind="primary" onPress={save} busy={busy} /></View>
        <Note>Next: add trucks by VIN, confirm their OEM schedules, then send the owner an invite.</Note>
      </Section>
    </Screen>
  );
}
