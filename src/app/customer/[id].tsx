// Admin · one customer: company, the approval gate, trucks + OEM schedule review,
// owner invite (Door 1, step 5), members, billing terms, and invoices.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { InvoiceRow } from '../../components/rows';
import { Button, Card, Field, KV, Loading, Note, Pill, Row, Screen, Section, s } from '../../components/ui';
import { ask, say } from '../../lib/alert';
import { loadFleet } from '../../lib/fleet';
import { errorMessage, longDate, num } from '../../lib/format';
import { truckStatus } from '../../lib/schedule';
import { APP_URL, must, rpc, supabase } from '../../lib/supabase';
import { C } from '../../lib/theme';
import type { Invoice } from '../../lib/types';
import { useData } from '../../lib/useData';

interface Member { user_id: string; role: string; profiles: { full_name: string | null; email: string | null } | null }
interface Invite { id: string; email: string; sent_at: string; accepted_at: string | null }

export default function Customer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invite, setInvite] = useState({ email: '', name: '' });
  const [billing, setBilling] = useState<{ fee: string; terms: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useData(async () => {
    const f = await loadFleet(id);
    const [members, invites, invoices] = await Promise.all([
      supabase.from('memberships').select('user_id, role, profiles(full_name, email)').eq('org_id', id).then(must),
      supabase.from('invitations').select('id, email, sent_at, accepted_at').eq('org_id', id).order('sent_at', { ascending: false }).then(must),
      supabase.from('invoices').select('*').eq('fleet_org_id', id).neq('status', 'void').order('issued_on', { ascending: false }).limit(10).then(must),
    ]);
    return { ...f, members: members as unknown as Member[], invites: invites as Invite[], invoices: invoices as Invoice[] };
  }, [id]);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const { org, vehicles, intervals, acts, members, invites, invoices } = data;
  const drafts = intervals.filter((i) => i.status === 'draft');
  const confirmed = intervals.filter((i) => i.status === 'confirmed');

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); reload(); if (done) say(done); } catch (e) { say('Something went wrong', errorMessage(e)); } finally { setBusy(false); }
  };

  const sendInvite = async () => {
    if (!invite.email.includes('@')) return say('Enter the owner’s email');
    if (drafts.length && !(await ask('Schedules not confirmed yet', `${drafts.length} OEM intervals are still drafts. The owner will see them as “pending review”. Send anyway?`, 'Send'))) return;
    await run(async () => {
      const { data: r, error: e } = await supabase.functions.invoke('invite-owner', {
        body: { orgId: org.id, email: invite.email.trim(), fullName: invite.name.trim(), redirectTo: `${APP_URL}/auth/callback` },
      });
      if (e) throw new Error((await (e as { context?: Response }).context?.json().catch(() => null))?.error ?? e.message);
      if (r?.error) throw new Error(r.error);
      setInvite({ email: '', name: '' });
    }, 'Invite sent. The owner sets a password and lands in this fleet.');
  };

  const saveBilling = () => run(async () => {
    must(await supabase.from('organizations').update({
      plan_fee_per_truck: billing!.fee.trim() === '' ? null : Number(billing!.fee), payment_terms_days: Number(billing!.terms) || 15,
    }).eq('id', org.id));
    setBilling(null);
  });

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <View style={{ padding: 16, gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pill label={org.status === 'active' ? 'Active' : org.status === 'pending' ? 'Pending approval' : 'Suspended'} tone={org.status === 'active' ? 'grn' : org.status === 'pending' ? 'amb' : 'red'} />
          <Pill label={org.signup_source === 'self' ? 'Self-signup' : 'Admin-created'} />
        </View>
        <Text style={s.h1}>{org.name}</Text>
        <Text style={{ color: C.soft }}>{org.account_number ? `Account ${org.account_number} · ` : ''}{[org.city, org.state].filter(Boolean).join(', ')}</Text>
      </View>

      <Section style={{ marginTop: 0, gap: 10 }}>
        {org.status === 'pending' && <Button title="Approve account" kind="primary" busy={busy} onPress={() => run(() => rpc('admin_set_org_status', { p_org: org.id, p_status: 'active' }), 'Approved. The owner has been notified.')} />}
        {org.status === 'suspended' && <Button title="Reactivate" busy={busy} onPress={() => run(() => rpc('admin_set_org_status', { p_org: org.id, p_status: 'active' }))} />}
        <Button title="Open fleet view" icon="eye-outline" onPress={() => router.push(`/fleet/${org.id}`)} />
      </Section>

      <Section title="Company" right={<Text style={{ color: C.amber, fontWeight: '700' }} onPress={() => router.push(`/profile?fleet=${org.id}`)}>Profile</Text>}>
        <Card>
          <KV k="Address" v={[org.address_line1, org.city, org.state, org.postal_code].filter(Boolean).join(', ') || '—'} />
          <KV k="Phone" v={org.phone ?? '—'} />
          <KV k="Primary contact" v={org.primary_contact_name ?? '—'} />
          <KV k="USDOT" v={org.usdot_number ?? '—'} />
          <KV k="Customer since" v={longDate(org.customer_since ?? org.created_at)} last />
        </Card>
      </Section>

      <Section title={`Trucks · ${vehicles.length}`} right={<Text style={{ color: C.amber, fontWeight: '700' }} onPress={() => router.push(`/add-truck?fleet=${org.id}`)}>+ Add by VIN</Text>}>
        {vehicles.map((v) => {
          const st = truckStatus(v, intervals, acts);
          const d = intervals.filter((i) => i.vehicle_id === v.id && i.status === 'draft').length;
          return (
            <Row key={v.id} title={`Unit ${v.unit_number} · ${[v.year, v.make, v.model].filter(Boolean).join(' ')}`} icon="bus-outline"
              meta={`${num(v.odometer_miles)} mi · VIN ${v.vin}`} small={d ? `${d} intervals to review` : st.line}
              right={<Pill label={d ? 'Review' : st.label} tone={d ? 'amb' : st.tone} />} onPress={() => router.push(`/unit/${v.id}`)} />
          );
        })}
        {!vehicles.length && <Note>No trucks yet. Add them by VIN — each gets a draft OEM schedule to review.</Note>}
      </Section>

      <Section title="OEM schedules">
        <Card>
          <KV k="Confirmed intervals" v={confirmed.length} />
          <KV k="Drafts awaiting review" v={drafts.length} color={drafts.length ? '#F6C46A' : undefined} last />
        </Card>
        {drafts.length > 0 && <Button title="Review & confirm" kind="primary" onPress={() => router.push(`/review/${org.id}`)} style={{ marginTop: 8 }} />}
        <Note>Each interval is checked against the OEM manual before it goes live — protects the OEM-spec promise.</Note>
      </Section>

      <Section title="Owner access">
        <Card>
          {members.map((m) => <KV key={m.user_id} k={m.profiles?.full_name || m.profiles?.email || m.user_id} sub={m.profiles?.email ?? undefined} v={m.role} />)}
          {invites.filter((i) => !i.accepted_at).map((i) => <KV key={i.id} k={i.email} sub={`Invited ${longDate(i.sent_at)}`} v="Invite pending" />)}
          {!members.length && !invites.length && <KV k="No users yet" v="" last />}
        </Card>
        <Field label="Owner email" value={invite.email} onChangeText={(t) => setInvite({ ...invite, email: t })} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Owner name" value={invite.name} onChangeText={(t) => setInvite({ ...invite, name: t })} />
        <Button title="Send invite" icon="mail-outline" onPress={sendInvite} busy={busy} style={{ marginTop: 10 }} />
      </Section>

      <Section title="Billing terms">
        {billing ? (
          <Card pad={false} style={{ padding: 14 }}>
            <Field label="Plan fee per truck (blank = platform default)" value={billing.fee} onChangeText={(t) => setBilling({ ...billing, fee: t })} keyboardType="decimal-pad" />
            <Field label="Payment terms (days)" value={billing.terms} onChangeText={(t) => setBilling({ ...billing, terms: t })} keyboardType="number-pad" />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button title="Cancel" kind="ghost" onPress={() => setBilling(null)} style={{ flex: 1 }} />
              <Button title="Save" kind="primary" onPress={saveBilling} busy={busy} style={{ flex: 1.4 }} />
            </View>
          </Card>
        ) : (
          <Card>
            <KV k="Plan fee per truck" v={org.plan_fee_per_truck != null ? `$${org.plan_fee_per_truck}` : 'Platform default'} />
            <KV k="Payment terms" v={`Net ${org.payment_terms_days}`} last />
          </Card>
        )}
        {!billing && <Button title="Edit billing terms" kind="ghost" onPress={() => setBilling({ fee: org.plan_fee_per_truck != null ? String(org.plan_fee_per_truck) : '', terms: String(org.payment_terms_days) })} style={{ marginTop: 8 }} />}
      </Section>

      <Section title="Recent invoices">
        {invoices.length ? invoices.map((i) => <InvoiceRow key={i.id} i={i} unit={vehicles.find((v) => v.id === i.vehicle_id)?.unit_number} />) : <Note>No invoices yet.</Note>}
      </Section>

      {org.status === 'active' && (
        <Section>
          <Button title="Suspend account" kind="danger" onPress={async () => {
            if (await ask('Suspend account?', `${org.name} keeps their data but is marked suspended.`, 'Suspend', true))
              run(() => rpc('admin_set_org_status', { p_org: org.id, p_status: 'suspended' }));
          }} />
        </Section>
      )}
    </Screen>
  );
}
