// The inspection checklists: what each type covers, and a printable blank form.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Chips, KV, Loading, Note, Screen, Section, s } from '../components/ui';
import { say } from '../lib/alert';
import { checklistHtml, exportPdf } from '../lib/export';
import { errorMessage } from '../lib/format';
import { must, supabase } from '../lib/supabase';
import type { InspectionItem, InspectionType } from '../lib/types';
import { useData } from '../lib/useData';

export default function Checklists() {
  const [pick, setPick] = useState<string | null>(null);
  const { data, error, reload } = useData(async () => {
    const [types, items] = await Promise.all([
      supabase.from('inspection_types').select('*').order('position').then(must),
      supabase.from('inspection_items').select('*').eq('active', true).order('section_position').order('position').then(must),
    ]);
    return { types: types as InspectionType[], items: items as InspectionItem[] };
  });
  if (!data) return <Loading error={error} onRetry={reload} />;
  const type = data.types.find((t) => t.name === pick) ?? data.types[0];
  if (!type) return <Loading error="No inspection types set up." />;
  const items = data.items.filter((i) => i.type_key === type.key);
  const sections = [...new Set(items.map((i) => i.section))];

  return (
    <Screen>
      <Section style={{ marginTop: 8 }}>
        <Chips options={data.types.map((t) => t.name)} value={type.name} onChange={setPick} />
      </Section>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 4 }}>
        <Text style={s.h1}>{type.name}</Text>
        <Text style={s.small}>{type.regulation}{type.every_days ? ` · every ${type.every_days === 365 ? '12 months' : `${type.every_days} days`}` : ''}</Text>
        <Text style={[s.meta, { marginTop: 4 }]}>{type.description}</Text>
      </View>
      <Section>
        <Button title="Print blank checklist (PDF)" kind="primary" icon="print-outline"
          onPress={() => exportPdf(type.name, checklistHtml(type, items)).catch((e) => say('Export failed', errorMessage(e)))} />
        <Note>{items.length} items in {sections.length} sections · {items.filter((i) => i.measure_unit).length} measured readings · {items.filter((i) => i.critical).length} out-of-service items (●).</Note>
      </Section>
      {sections.map((sec) => (
        <Section key={sec} title={sec}>
          <Card>
            {items.filter((i) => i.section === sec).map((i, n, arr) => (
              <KV key={i.id} k={`${i.critical ? '● ' : ''}${i.label}`} sub={[i.guidance, i.reference].filter(Boolean).join(' · ')}
                v={i.measure_unit ? `reading (${i.measure_unit})` : ''} last={n === arr.length - 1} />
            ))}
          </Card>
        </Section>
      ))}
    </Screen>
  );
}
