import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { say } from '../../lib/alert';
import { Button, Field, Screen, s } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

export default function SetPassword() {
  const { refresh } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (password.length < 8) return say('Password too short', 'Use at least 8 characters.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return say('Could not save', error.message);
    await refresh();
    router.replace('/');
  };
  return (
    <Screen>
      <View style={{ padding: 20 }}>
        <Text style={s.sub}>Choose a password to finish setting up your account. Your fleet is ready for you.</Text>
        <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        <View style={{ marginTop: 20 }}><Button title="Save and continue" kind="primary" onPress={save} busy={busy} /></View>
      </View>
    </Screen>
  );
}
