import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { say } from '../../lib/alert';
import { Button, Field, Screen, s } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { APP_URL, supabase } from '../../lib/supabase';
import { C } from '../../lib/theme';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      router.replace('/');
    } catch (e) {
      say('Could not sign in', errorMessage(e));
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!email.trim()) return say('Enter your email first');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${APP_URL}/auth/callback` });
    say(error ? 'Could not send link' : 'Check your email', error?.message ?? 'We sent you a link to set a new password.');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ padding: 24, paddingTop: 16, width: '100%', maxWidth: 460, alignSelf: 'center' }}>
        <Pressable onPress={() => router.replace('/welcome')} accessibilityRole="link" accessibilityLabel="Northgate Fleet Systems home" style={{ alignSelf: 'center' }}>
          <Image source={require('../../../assets/logo.png')} resizeMode="contain" style={{ width: 300, height: 195 }} />
        </Pressable>
        <Text style={[s.h1, { marginTop: 8 }]}>Sign in</Text>
        <Text style={[s.sub, { marginTop: 4 }]}>OEM-spec schedules, transparent invoices, and your approval on every repair.</Text>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={signIn} />
        <View style={{ marginTop: 20, gap: 10 }}>
          <Button title="Sign in" kind="primary" onPress={signIn} busy={busy} />
          <Button title="Forgot password" kind="ghost" onPress={reset} />
        </View>
        <Text style={[s.sub, { marginTop: 28, textAlign: 'center' }]}>
          New fleet? <Link href="/auth/sign-up" style={{ color: C.amber, fontWeight: '700' }}>Start a free trial</Link>
        </Text>
      </View>
    </Screen>
  );
}
