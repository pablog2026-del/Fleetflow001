import { router } from 'expo-router';
import { useEffect } from 'react';
import { Empty, Loading, Row, Screen, Section } from '../components/ui';
import { dateLabel } from '../lib/format';
import { must, rpc, supabase } from '../lib/supabase';
import type { NotificationRow } from '../lib/types';
import { useData } from '../lib/useData';

export default function Notifications() {
  const { data, error, reload } = useData(async () =>
    must(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)) as NotificationRow[]);
  useEffect(() => { rpc('mark_notifications_read').catch(() => {}); }, []);
  if (!data) return <Loading error={error} onRetry={reload} />;
  return (
    <Screen onRefresh={reload}>
      <Section style={{ marginTop: 8 }}>
        {data.length ? data.map((n) => (
          <Row key={n.id} title={n.title} meta={n.body ?? undefined} small={dateLabel(n.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            icon={n.urgent ? 'warning' : n.read_at ? 'notifications-outline' : 'notifications'} tone={n.urgent ? 'red' : n.read_at ? 'grey' : 'amb'}
            onPress={n.activity_id ? () => router.push(`/activity/${n.activity_id}`) : n.interval_id ? () => router.push(`/interval/${n.interval_id}`)
              : n.invoice_id ? () => router.push(`/invoice/${n.invoice_id}`) : undefined} />
        )) : <Empty>No updates yet.</Empty>}
      </Section>
    </Screen>
  );
}
