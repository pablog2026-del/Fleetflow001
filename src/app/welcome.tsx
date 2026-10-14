// Public landing page: what Northgate Fleet Systems does, with Sign in / Start a free trial.
// Positioning (spec §12): lead with OEM-spec schedules from the VIN, transparent invoices,
// and owner approval on every repair.
import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { Image, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { IconName } from '../components/ui';
import { useAuth } from '../lib/auth';
import { C, TONES } from '../lib/theme';

const LOGO = require('../../assets/logo.png');

const PILLARS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'barcode-outline', title: 'OEM schedules from the VIN',
    body: 'Add a truck by its VIN. Its service intervals come from the OEM spec — miles, engine hours or time, whichever comes first — and every one is reviewed before it goes live.' },
  { icon: 'receipt-outline', title: 'Transparent invoices',
    body: 'Every line shows its work: labor as book hours × rate, parts listed by part number and price. No surprises, no padding.' },
  { icon: 'checkmark-circle-outline', title: 'You approve every repair',
    body: 'Nothing gets done without your OK. Approve, decline or defer each estimate from your phone — deferrals stay on your reminders.' },
];

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'calendar-outline', title: 'Calendar & reminders', body: 'Scheduled work around weekends, holidays and rain days, plus everything coming due.' },
  { icon: 'clipboard-outline', title: 'Inspection checklists', body: 'Annual DOT inspection (49 CFR 396.17) and a monthly in-depth inspection, item by item.' },
  { icon: 'warning-outline', title: 'Breakdown response', body: 'Report a truck down with location and photos; your provider is paged right away.' },
  { icon: 'bar-chart-outline', title: 'Fleet reports', body: 'Cost per mile and per engine hour, downtime, PM compliance — PDF and CSV.' },
  { icon: 'document-text-outline', title: 'DOT-ready file', body: 'Inspections, repairs, defects closed and deferrals for every truck, ready to print.' },
  { icon: 'card-outline', title: 'Pay online', body: 'Pay one invoice or all of them by bank transfer. Statements and year-end summaries built in.' },
];

const STEPS = [
  ['Add your trucks', 'Enter each VIN. We decode it and draft the OEM service schedule.'],
  ['Schedules reviewed', 'Each interval is checked against the OEM spec before reminders start.'],
  ['Approve and track', 'Estimates come to you. Watch work move from scheduled to done.'],
  ['Invoices and reports', 'Clear invoices, spend by truck, and a DOT file always up to date.'],
];

export default function Welcome() {
  const { session, loading } = useAuth();
  const { width } = useWindowDimensions();
  if (!loading && session) return <Redirect href="/" />;
  const wide = width >= 860;
  const cols = width >= 1000 ? 3 : width >= 640 ? 2 : 1;
  const gutter = 16;
  const maxW = 1080;
  const inner = Math.min(width, maxW) - gutter * 2;
  const cardW = (inner - (cols - 1) * 12) / cols;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ width: '100%', maxWidth: maxW, alignSelf: 'center', paddingHorizontal: gutter }}>
          {/* top bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 }}>
            <Text style={{ color: C.amber, fontWeight: '800', letterSpacing: 1.2, fontSize: 13 }}>NORTHGATE FLEET SYSTEMS</Text>
            <Pressable onPress={() => router.push('/auth/sign-in')} accessibilityRole="button"
              style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: C.line2, justifyContent: 'center' }}>
              <Text style={{ color: C.text, fontWeight: '700' }}>Sign in</Text>
            </Pressable>
          </View>

          {/* hero */}
          <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: wide ? 32 : 8, paddingTop: wide ? 24 : 4 }}>
            <Image source={LOGO} accessibilityLabel="Northgate Fleet Systems" resizeMode="contain"
              style={{ width: wide ? 480 : Math.min(inner, 520), height: (wide ? 480 : Math.min(inner, 520)) * 0.651 }} />
            <View style={{ flex: wide ? 1 : undefined, gap: 14, width: wide ? undefined : '100%' }}>
              <Text style={{ color: C.text, fontSize: wide ? 44 : 32, fontWeight: '800', lineHeight: wide ? 50 : 38 }}>
                Fleet maintenance by the OEM book.
              </Text>
              <Text style={{ color: C.soft, fontSize: 17, lineHeight: 25 }}>
                OEM-spec service schedules built from every VIN, inspections done item by item, transparent invoices, and your approval on every repair — for heavy-duty fleets and the shops that keep them running.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                <Cta title="Start a free trial" primary onPress={() => router.push('/auth/sign-up')} />
                <Cta title="Sign in" onPress={() => router.push('/auth/sign-in')} />
              </View>
              <Text style={{ color: C.muted, fontSize: 13 }}>New accounts start as a trial and are reviewed by Northgate.</Text>
            </View>
          </View>

          {/* pillars */}
          <Heading kicker="Why Northgate" title="Built on three promises" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {PILLARS.map((p) => (
              <View key={p.title} style={{ width: cardW, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 18, gap: 8 }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: TONES.amb.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={p.icon} size={24} color={TONES.amb.fg} />
                </View>
                <Text style={{ color: C.text, fontSize: 19, fontWeight: '800' }}>{p.title}</Text>
                <Text style={{ color: C.soft, fontSize: 15, lineHeight: 22 }}>{p.body}</Text>
              </View>
            ))}
          </View>

          {/* how it works */}
          <Heading kicker="How it works" title="From VIN to invoice" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {STEPS.map(([t, b], i) => (
              <View key={t} style={{ width: cols === 1 ? inner : (inner - 12) / 2, flexDirection: 'row', gap: 14, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: C.amberInk, fontWeight: '900', fontSize: 16 }}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{t}</Text>
                  <Text style={{ color: C.soft, fontSize: 15, lineHeight: 21 }}>{b}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* features */}
          <Heading kicker="What's inside" title="Everything your fleet's maintenance needs" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {FEATURES.map((f) => (
              <View key={f.title} style={{ width: cardW, flexDirection: 'row', gap: 12, paddingVertical: 10 }}>
                <Ionicons name={f.icon} size={24} color={C.amber} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{f.title}</Text>
                  <Text style={{ color: C.soft, fontSize: 14, lineHeight: 20 }}>{f.body}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* closing CTA */}
          <View style={{ marginTop: 36, borderRadius: 16, borderWidth: 1, borderColor: TONES.amb.ln, backgroundColor: '#1E1A12', padding: 24, gap: 12, alignItems: wide ? 'center' : 'flex-start' }}>
            <Text style={{ color: C.text, fontSize: 24, fontWeight: '800', textAlign: wide ? 'center' : 'left' }}>Bring your fleet onto Northgate</Text>
            <Text style={{ color: C.soft, fontSize: 15, textAlign: wide ? 'center' : 'left' }}>Set up your company, add trucks by VIN, and see what’s coming due.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Cta title="Start a free trial" primary onPress={() => router.push('/auth/sign-up')} />
              <Cta title="Sign in" onPress={() => router.push('/auth/sign-in')} />
            </View>
          </View>

          <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 28 }}>
            © {new Date().getFullYear()} Northgate Fleet Systems · Raleigh, NC
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Heading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <View style={{ marginTop: 40, marginBottom: 16, gap: 4 }}>
      <Text style={{ color: C.amber, fontWeight: '800', letterSpacing: 1, fontSize: 13 }}>{kicker.toUpperCase()}</Text>
      <Text style={{ color: C.text, fontSize: 26, fontWeight: '800' }}>{title}</Text>
    </View>
  );
}

function Cta({ title, onPress, primary }: { title: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 50, paddingHorizontal: 22, borderRadius: 12, justifyContent: 'center', borderWidth: 1,
        borderColor: primary ? C.amber : C.line2, backgroundColor: primary ? C.amber : C.panel, opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ color: primary ? C.amberInk : C.text, fontWeight: '800', fontSize: 17 }}>{title}</Text>
    </Pressable>
  );
}
