// Small UI kit matching the owner simulator: cards, rows, pills, key/value lines,
// segmented tabs, chips and buttons. Phone-first, 44pt+ touch targets.
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, TONES } from '../lib/theme';
import type { Tone } from '../lib/schedule';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, refreshing, onRefresh, edges = ['bottom'] }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void; edges?: ('top' | 'bottom')[];
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={edges}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32, width: '100%', maxWidth: 720, alignSelf: 'center' }}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.amber} /> : undefined}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Loading({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
      {error ? (
        <>
          <Text style={[s.text, { textAlign: 'center' }]}>{error}</Text>
          {onRetry && <Button title="Try again" onPress={onRetry} />}
        </>
      ) : <ActivityIndicator color={C.amber} />}
    </View>
  );
}

export function Header({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <View style={s.top}>
      <View style={{ flexShrink: 1 }}>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
        <Text style={s.h1}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

export function Section({ title, children, style, right }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle>; right?: ReactNode }) {
  return (
    <View style={[s.sec, style]}>
      {title ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={s.h2}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Card({ children, style, pad = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; pad?: boolean }) {
  return <View style={[s.card, pad && { paddingHorizontal: 16, paddingVertical: 2 }, style]}>{children}</View>;
}

export function Pill({ label, tone = 'grey', dot }: { label: string; tone?: Tone; dot?: boolean }) {
  const t = TONES[tone];
  return (
    <View style={[s.pill, { backgroundColor: t.bg, borderColor: t.ln }]}>
      {dot && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.fg }} />}
      <Text style={{ color: t.fg, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function KV({ k, v, last, strong, color, sub }: { k: string; v: ReactNode; last?: boolean; strong?: boolean; color?: string; sub?: string }) {
  return (
    <View style={[s.kv, last && { borderBottomWidth: 0 }]}>
      <View style={{ flexShrink: 1 }}>
        <Text style={[s.kvk, strong && { color: C.text, fontWeight: '700', fontSize: 18 }]}>{k}</Text>
        {sub ? <Text style={s.small}>{sub}</Text> : null}
      </View>
      {typeof v === 'string' || typeof v === 'number'
        ? <Text style={[s.kvv, strong && { fontSize: 20 }, color ? { color } : null]}>{v}</Text>
        : v}
    </View>
  );
}

export function Row({ title, meta, small, right, icon, tone = 'grey', onPress, children }: {
  title: string; meta?: string; small?: ReactNode; right?: ReactNode; icon?: IconName; tone?: Tone;
  onPress?: () => void; children?: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.75 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {icon && (
          <View style={[s.ico, { backgroundColor: t.bg }]}>
            <Ionicons name={icon} size={20} color={t.fg} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.ttl}>{title}</Text>
          {meta ? <Text style={s.meta}>{meta}</Text> : null}
          {typeof small === 'string' ? <Text style={s.small}>{small}</Text> : small}
        </View>
        {right}
        {onPress && !right ? <Ionicons name="chevron-forward" size={18} color={C.muted} /> : null}
      </View>
      {children}
    </Pressable>
  );
}

export function Button({ title, onPress, kind = 'default', icon, disabled, busy, style }: {
  title: string; onPress: () => void; kind?: 'default' | 'primary' | 'ghost' | 'danger'; icon?: IconName;
  disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const pri = kind === 'primary';
  const fg = pri ? C.amberInk : kind === 'danger' ? TONES.red.fg : C.text;
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button"
      style={({ pressed }) => [s.btn, pri && s.btnPri, kind === 'ghost' && { backgroundColor: 'transparent' },
        kind === 'danger' && { borderColor: TONES.red.ln }, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: pri ? 18 : 16, letterSpacing: pri ? 0.4 : 0 }}>{title}</Text>
    </Pressable>
  );
}

export function Seg<T extends string>({ options, value, onChange, counts }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; counts?: Partial<Record<T, number>>;
}) {
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[s.segBtn, on && { backgroundColor: C.amber }]}>
            {counts && <Text style={{ fontSize: 20, fontWeight: '800', color: on ? C.amberInk : C.text }}>{counts[o] ?? 0}</Text>}
            <Text style={{ fontSize: 13, fontWeight: '600', color: on ? C.amberInk : C.soft }} numberOfLines={1}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={[s.chip, on && { backgroundColor: C.amber, borderColor: C.amber }]}>
            <Text style={{ color: on ? C.amberInk : '#D3D8DE', fontWeight: '600', fontSize: 15 }}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, hint, style, ...props }: TextInputProps & { label: string; hint?: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={{ marginTop: 14, gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#6B7380" style={[s.input, props.multiline && { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }, style]} {...props} />
      {hint ? <Text style={s.small}>{hint}</Text> : null}
    </View>
  );
}

export function Tile({ n, label, tone, onPress }: { n: number | string; label: string; tone?: Tone; onPress?: () => void }) {
  const t = tone ? TONES[tone] : { bg: C.panel, fg: C.text, ln: C.line };
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[s.tile, { backgroundColor: t.bg, borderColor: t.ln }]}>
      <Text style={{ fontSize: 26, fontWeight: '800', color: t.fg }} numberOfLines={1} adjustsFontSizeToFit>{n}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: C.soft }}>{label}</Text>
    </Pressable>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <View style={[s.card, { padding: 20 }]}><Text style={{ color: C.soft, textAlign: 'center', fontSize: 15 }}>{children}</Text></View>;
}

export function Note({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.small, { marginTop: 8, marginHorizontal: 2 }, style]}>{children}</Text>;
}

export const s = StyleSheet.create({
  text: { color: C.text, fontSize: 15 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, gap: 10 },
  h1: { color: C.text, fontSize: 28, fontWeight: '800', lineHeight: 32 },
  h2: { color: C.text, fontSize: 19, fontWeight: '800', marginHorizontal: 2 },
  sub: { color: C.muted, fontSize: 14 },
  sec: { marginTop: 20, marginHorizontal: 16 },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14, minHeight: 44, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  kvk: { color: C.muted, fontSize: 15 },
  kvv: { color: C.text, fontSize: 15, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  row: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56, marginBottom: 8 },
  ico: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  ttl: { color: C.text, fontSize: 16, fontWeight: '600' },
  meta: { color: C.soft, fontSize: 14 },
  small: { color: C.muted, fontSize: 13 },
  btn: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: C.line2, backgroundColor: C.panel, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  btnPri: { backgroundColor: C.amber, borderColor: C.amber },
  seg: { flexDirection: 'row', gap: 4, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 4 },
  segBtn: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: C.line2, backgroundColor: C.panel, justifyContent: 'center' },
  label: { color: C.soft, fontSize: 14, fontWeight: '600' },
  input: { minHeight: 50, borderRadius: 10, borderWidth: 1, borderColor: C.line2, backgroundColor: C.input, color: C.text, fontSize: 16, paddingHorizontal: 12 },
  tile: { flex: 1, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 4, minHeight: 72 },
  grid: { flexDirection: 'row', gap: 8 },
});
