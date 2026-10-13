// Customer profile: company, account, contacts, fleet, service agreement, account summary.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Button, Card, Field, KV, Loading, Pill, Screen, Section, s } from '../components/ui';
import { say } from '../lib/alert';
import { useAuth } from '../lib/auth';
import { loadFleet } from '../lib/fleet';
import { errorMessage, longDate, money } from '../lib/format';
import { isOpen } from '../lib/schedule';
import { must, rpc, supabase } from '../lib/supabase';
import { C, TONES } from '../lib/theme';
import type { PlatformSettings } from '../lib/types';
import { useData } from '../lib/useData';
import { useFleetId } from '../lib/useFleetId';

const FIELDS = [
  ['name', 'Company name'], ['address_line1', 'Street address'], ['city', 'City'], ['state', 'State'], ['postal_code', 'ZIP'],
  ['phone', 'Phone'], ['email', 'Email'], ['usdot_number', 'USDOT number'], ['primary_contact_name', 'Primary contact'],
  ['primary_contact_title', 'Title'], ['billing_contact', 'Billing contact'], ['service_location', 'Service location'],
] as const;

export default function Profile() {
  const fleetId = useFleetId();
  const { isAdmin, signOut } = useAuth();
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useData(async () => {
    const f = await loadFleet(fleetId!);
    const [settings, provider, spent] = await Promise.all([
      supabase.from('platform_settings').select('*').maybeSingle().then(must),
      supabase.from('organizations').select('name, labor_rate, parts_markup_pct').eq('type', 'provider').limit(1).then(must),
      supabase.from('invoices').select('total').eq('fleet_org_id', fleetId!).eq('kind', 'service').neq('status', 'void').then(must),
    ]);
    return { ...f, settings: settings as PlatformSettings | null, provider: (provider as { name: string; labor_rate: number | null; parts_markup_pct: number }[])[0],
      spent: (spent as { total: number }[]).reduce((a, r) => a + Number(r.total), 0) };
  }, [fleetId], !!fleetId);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const { org, vehicles, acts, settings, provider, spent } = data;
  const makes = Object.entries(vehicles.reduce<Record<string, number>>((m, v) => ({ ...m, [v.make ?? 'Unknown']: (m[v.make ?? 'Unknown'] ?? 0) + 1 }), {}))
    .map(([k, n]) => `${n} ${k}`).join(' · ');
  const out = vehicles.filter((v) => !v.in_service).length;
  const awaiting = acts.filter((a) => a.status === 'estimate').length;
  const fee = org.plan_fee_per_truck ?? settings?.plan_fee_per_truck;
  const rate = provider?.labor_rate ?? settings?.default_labor_rate;
  const address = [org.address_line1, org.city, [org.state, org.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const save = async () => {
    setBusy(true);
    try { await rpc('update_my_company', { p_org: org.id, p: edit }); setEdit(null); reload(); }
    catch (e) { say('Could not save', errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Screen onRefresh={reload}>
      <Section style={{ marginTop: 8 }}>
        <Card pad={false} style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 60, height: 60, borderRadius: 14, backgroundColor: '#2B2416', borderWidth: 1, borderColor: '#5E4820', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="business-outline" size={30} color={TONES.amb.fg} />
          </View>
          <View style={{ flexShrink: 1, gap: 4 }}>
            <Text style={s.h1}>{org.name}</Text>
            <Text style={{ color: C.soft }}>{org.account_number ? `Account ${org.account_number} · ` : ''}Customer since {longDate(org.customer_since ?? org.created_at)}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pill label={org.status === 'active' ? 'Active' : org.status === 'pending' ? 'Trial · pending approval' : 'Suspended'} tone={org.status === 'active' ? 'grn' : org.status === 'pending' ? 'amb' : 'red'} />
              {awaiting > 0 && <Pill label={`${awaiting} awaiting approval`} tone="amb" />}
            </View>
          </View>
        </Card>
      </Section>
      <Section style={{ flexDirection: 'row', gap: 8 }}>
        {org.phone && <Button title="Call" icon="call-outline" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${org.phone!.replace(/[^\d+]/g, '')}`)} />}
        {address && <Button title="Directions" icon="navigate-outline" style={{ flex: 1 }} onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(address)}`)} />}
      </Section>

      {edit ? (
        <Section title="Edit company">
          {FIELDS.map(([k, label]) => <Field key={k} label={label} value={edit[k] ?? ''} onChangeText={(t) => setEdit({ ...edit, [k]: t })} />)}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Button title="Cancel" kind="ghost" onPress={() => setEdit(null)} style={{ flex: 1 }} />
            <Button title="Save" kind="primary" onPress={save} busy={busy} style={{ flex: 1.4 }} />
          </View>
        </Section>
      ) : (
        <Section title="Company" right={<Pressable onPress={() => setEdit(Object.fromEntries(FIELDS.map(([k]) => [k, String(org[k] ?? '')])))}><Text style={{ color: C.amber, fontWeight: '700' }}>Edit</Text></Pressable>}>
          <Card>
            <KV k="Account number" v={org.account_number ?? 'Assigned on approval'} />
            <KV k="Address" v={address || '—'} />
            <KV k="Phone" v={org.phone ?? '—'} />
            <KV k="Primary contact" v={[org.primary_contact_name, org.primary_contact_title].filter(Boolean).join(' · ') || '—'} />
            <KV k="Email" v={org.email ?? '—'} />
            <KV k="USDOT number" v={org.usdot_number ?? '—'} last />
          </Card>
        </Section>
      )}

      <Section title="Fleet">
        <Card>
          <KV k="Trucks" v={`${vehicles.length} (${vehicles.length - out} in service, ${out} out)`} />
          <KV k="Makes" v={makes || '—'} />
          <KV k="Service location" v={org.service_location ?? '—'} last />
        </Card>
      </Section>

      <Section title="Service agreement">
        <Card>
          <KV k="Provider" v={provider?.name ?? '—'} />
          <KV k="Plan" v="Monthly per-truck fee" />
          <KV k="Monthly fee" v={fee != null ? `${money(fee)} × ${vehicles.length}` : '—'} />
          <KV k="Labor rate" v={rate != null ? `${money(rate)}/hr · OEM book time` : '—'} />
          <KV k="Parts" v={Number(provider?.parts_markup_pct ?? 0) === 0 ? 'Billed at cost — no markup' : `Cost + ${provider?.parts_markup_pct}%`} />
          <KV k="Payment terms" v={`Net ${org.payment_terms_days}`} />
          <KV k="Approval required" v="Every repair activity" last />
        </Card>
      </Section>

      <Section title="Account summary">
        <Card>
          <KV k="Repair activities completed" v={acts.filter((a) => a.status === 'done').length} />
          <KV k="Total spent" v={money(spent)} />
          <KV k="Open repair activities" v={acts.filter(isOpen).length} />
          <KV k="Billing contact" v={org.billing_contact ?? '—'} last />
        </Card>
      </Section>

      {!isAdmin && (
        <Section style={{ gap: 10 }}>
          <Button title="Security (two-factor)" icon="shield-checkmark-outline" onPress={() => router.push('/security')} />
          <Button title="Sign out" kind="ghost" onPress={async () => { await signOut(); router.replace('/auth/sign-in'); }} />
        </Section>
      )}
    </Screen>
  );
}
