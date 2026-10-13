// Platform settings: revenue model, fee rates, plan tiers; accounts & access.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Chips, Field, Header, KV, Loading, Note, Pill, Screen, Section, s } from '../../components/ui';
import { say } from '../../lib/alert';
import { useAuth } from '../../lib/auth';
import { errorMessage, money } from '../../lib/format';
import { must, supabase } from '../../lib/supabase';
import type { PlanTier, PlatformSettings } from '../../lib/types';
import { useData } from '../../lib/useData';

const MODELS = { subscription: 'A · Subscription', fee: 'B · Fee on payments', both: 'C · Both' } as const;
type Model = keyof typeof MODELS;

interface Access { user_id: string; role: string; organizations: { name: string; type: string } | null; profiles: { full_name: string | null; email: string | null } | null }

export default function Settings() {
  const { signOut } = useAuth();
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [model, setModel] = useState<Model>('subscription');
  const [tiers, setTiers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useData(async () => {
    const [settings, planTiers, access] = await Promise.all([
      supabase.from('platform_settings').select('*').single().then(must),
      supabase.from('plan_tiers').select('*').order('applies_to').then(must),
      supabase.from('memberships').select('user_id, role, organizations(name, type), profiles(full_name, email)').then(must),
    ]);
    return { settings: settings as PlatformSettings, tiers: planTiers as PlanTier[], access: access as unknown as Access[] };
  });
  useEffect(() => {
    if (!data) return;
    const st = data.settings;
    setModel(st.revenue_model);
    setF({ plan_fee_per_truck: String(st.plan_fee_per_truck), platform_fee_bps: String(st.platform_fee_bps), default_labor_rate: String(st.default_labor_rate),
      default_payment_terms_days: String(st.default_payment_terms_days), sales_tax_rate: String(Number(st.sales_tax_rate) * 100), trial_days: String(st.trial_days) });
    setTiers(Object.fromEntries(data.tiers.map((t) => [t.id, String(t.price_per_unit)])));
  }, [data]);
  if (!data || !f) return <Loading error={error} onRetry={reload} />;

  const save = async () => {
    setBusy(true);
    try {
      must(await supabase.from('platform_settings').update({
        revenue_model: model, plan_fee_per_truck: Number(f.plan_fee_per_truck) || 0, platform_fee_bps: Math.round(Number(f.platform_fee_bps) || 0),
        default_labor_rate: Number(f.default_labor_rate) || 0, default_payment_terms_days: Number(f.default_payment_terms_days) || 15,
        sales_tax_rate: (Number(f.sales_tax_rate) || 0) / 100, trial_days: Number(f.trial_days) || 30, updated_at: new Date().toISOString(),
      }).eq('id', true));
      for (const t of data.tiers) {
        if (String(t.price_per_unit) !== tiers[t.id]) must(await supabase.from('plan_tiers').update({ price_per_unit: Number(tiers[t.id]) || 0 }).eq('id', t.id));
      }
      reload();
      say('Settings saved');
    } catch (e) { say('Could not save', errorMessage(e)); } finally { setBusy(false); }
  };
  const set = (k: string) => (t: string) => setF({ ...f, [k]: t });

  return (
    <Screen edges={['top']}>
      <Header title="Platform settings" sub="Northgate Fleet Systems" />
      <Section title="Revenue model" style={{ marginTop: 6 }}>
        <Chips options={Object.values(MODELS)} value={MODELS[model]} onChange={(l) => setModel((Object.keys(MODELS) as Model[]).find((k) => MODELS[k] === l)!)} />
        <Note>Open decision (§12). Subscription = monthly plan invoices; fee = a cut of each payment via Stripe Connect; both = most common in this market.</Note>
      </Section>
      <Section title="Fees & defaults">
        <Field label="Plan fee per truck / month ($)" value={f.plan_fee_per_truck} onChangeText={set('plan_fee_per_truck')} keyboardType="decimal-pad" />
        <Field label="Platform fee on payments (basis points)" value={f.platform_fee_bps} onChangeText={set('platform_fee_bps')} keyboardType="number-pad"
          hint={`${(Number(f.platform_fee_bps) / 100).toFixed(2)}% of each invoice · used when the model is B or C`} />
        <Field label="Default labor rate ($/hr)" value={f.default_labor_rate} onChangeText={set('default_labor_rate')} keyboardType="decimal-pad" hint="Used when a provider hasn’t set its own rate." />
        <Field label="Default payment terms (days)" value={f.default_payment_terms_days} onChangeText={set('default_payment_terms_days')} keyboardType="number-pad" />
        <Field label="Sales tax rate (%)" value={f.sales_tax_rate} onChangeText={set('sales_tax_rate')} keyboardType="decimal-pad" hint="Leave 0 until the CPA confirms NC taxability of parts & repair labor." />
        <Field label="Self-signup trial (days)" value={f.trial_days} onChangeText={set('trial_days')} keyboardType="number-pad" />
      </Section>
      <Section title="Plan tiers">
        {data.tiers.map((t) => (
          <Field key={t.id} label={`${t.name} ($ per ${t.unit})`} value={tiers[t.id] ?? ''} onChangeText={(x) => setTiers({ ...tiers, [t.id]: x })} keyboardType="decimal-pad" />
        ))}
        <Button title="Save settings" kind="primary" onPress={save} busy={busy} style={{ marginTop: 16 }} />
      </Section>
      <Section title="Accounts & access">
        <Card>
          {data.access.map((m, i) => (
            <KV key={`${m.user_id}-${i}`} k={m.profiles?.full_name || m.profiles?.email || m.user_id}
              sub={`${m.organizations?.name ?? ''} · ${m.organizations?.type ?? ''}`}
              v={<Pill label={m.role} tone={m.role === 'admin' ? 'amb' : 'grey'} />} last={i === data.access.length - 1} />
          ))}
        </Card>
        <Note>Admin and provider are separate memberships, even for the same person.</Note>
      </Section>
      <Section style={{ gap: 10 }}>
        <Button title="Inspection checklists" icon="clipboard-outline" onPress={() => router.push('/checklists')} />
        <Button title="Security (two-factor)" icon="shield-checkmark-outline" onPress={() => router.push('/security')} />
        <Button title="Sign out" kind="ghost" onPress={async () => { await signOut(); router.replace('/auth/sign-in'); }} />
        <View style={{ height: 8 }} />
        <Text style={[s.small, { textAlign: 'center' }]}>Platform fee & payouts settle through Stripe Connect.</Text>
        <Text style={[s.small, { textAlign: 'center' }]}>Default rate shown to fleets: {money(data.settings.default_labor_rate)}/hr</Text>
      </Section>
    </Screen>
  );
}
