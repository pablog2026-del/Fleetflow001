import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { dateLabel, money } from '../lib/format';
import { invoiceState, STATUS, type Forecast, type Item } from '../lib/schedule';
import type { Invoice, RepairActivity, Vehicle } from '../lib/types';
import { Pill, Row, s } from './ui';

export function ActivityRow({ a, unit }: { a: RepairActivity; unit?: string }) {
  const st = STATUS[a.status];
  const when =
    a.status === 'done' ? `Completed ${dateLabel(a.completed_at)}`
    : a.status === 'scheduled' && a.scheduled_for ? `Scheduled ${dateLabel(a.scheduled_for)}`
    : a.status === 'deferred' ? `Deferred: ${a.deferred_reason ?? ''}`
    : `Opened ${dateLabel(a.created_at)}`;
  const tone = a.kind === 'breakdown' && a.status === 'requested' ? 'red' : st.tone;
  return (
    <Row title={`RA #${a.id}${unit ? ' · Unit ' + unit : ''}`} meta={a.title} small={when}
      icon={a.kind === 'breakdown' ? 'warning' : 'construct'} tone={tone}
      right={<Pill label={a.kind === 'breakdown' && a.status === 'requested' ? 'Breakdown' : st.label} tone={tone} />}
      onPress={() => router.push(`/activity/${a.id}`)} />
  );
}

export function ForecastRow({ f, showUnit }: { f: Forecast; showUnit?: boolean }) {
  const tone = f.due.over ? 'red' : 'amb';
  return (
    <Row title={f.interval.task}
      meta={`${showUnit ? 'Unit ' + f.vehicle.unit_number + ' · ' : ''}${f.due.over ? 'Overdue — ' : 'Due '}${f.due.lead}`}
      small={f.deferred ? `Deferred: ${f.deferred.deferred_reason ?? ''}` : 'From OEM schedule · not scheduled yet'}
      icon="time" tone={tone}
      right={<Pill label={f.deferred ? 'Deferred' : f.due.over ? 'Overdue' : 'Due soon'} tone={tone} />}
      onPress={() => router.push(`/interval/${f.interval.id}`)} />
  );
}

export function ItemRow({ x, vehicles, showUnit }: { x: Item; vehicles: Vehicle[]; showUnit?: boolean }) {
  if (x.kind === 'forecast') return <ForecastRow f={x} showUnit={showUnit} />;
  const unit = showUnit ? vehicles.find((v) => v.id === x.activity.vehicle_id)?.unit_number : undefined;
  return <ActivityRow a={x.activity} unit={unit} />;
}

export function InvoiceRow({ i, unit, fleet }: { i: Invoice; unit?: string; fleet?: string }) {
  const st = invoiceState(i);
  return (
    <Row title={`${i.number}${unit ? ' · Unit ' + unit : ''}${fleet ? ' · ' + fleet : ''}`} meta={i.memo ?? ''}
      small={`Issued ${dateLabel(i.issued_on)}${i.paid_at ? ' · paid ' + dateLabel(i.paid_at) : ''}`}
      right={<View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[s.ttl, { textAlign: 'right' }]}>{money(i.total)}</Text>
        <Pill label={st.label} tone={st.tone} />
      </View>}
      onPress={() => router.push(`/invoice/${i.id}`)} />
  );
}
