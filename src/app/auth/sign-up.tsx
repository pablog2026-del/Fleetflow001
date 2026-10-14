// Door 2: self-signup. The account starts empty and pending until Admin approves.
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { say } from '../../lib/alert';
import { Button, Field, Screen, s } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { APP_URL, supabase } from '../../lib/supabase';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 8) return say('Password too short', 'Use at least 8 characters.');
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: `${APP_URL}/auth/callback` },
      });
      if (error) throw error;
      if (!data.session) {
        say('Confirm your email', 'We sent you a link. Open it to finish creating your account.');
        router.replace('/auth/sign-in');
      } else {
        router.replace('/onboarding');
      }
    } catch (e) {
      say('Could not sign up', errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <View style={{ padding: 20, width: '100%', maxWidth: 460, alignSelf: 'center' }}>
        <Image source={require('../../../assets/logo.png')} resizeMode="contain" accessibilityLabel="Northgate Fleet Systems"
          style={{ width: 220, height: 143, alignSelf: 'center', marginBottom: 8 }} />
        <Text style={s.sub}>Your account starts as a trial. Add your company and trucks by VIN; Northgate reviews your OEM schedules before anything is official.</Text>
        <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" hint="At least 8 characters." />
        <View style={{ marginTop: 20 }}><Button title="Create account" kind="primary" onPress={submit} busy={busy} /></View>
      </View>
    </Screen>
  );
}
