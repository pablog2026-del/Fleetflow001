import { Redirect } from 'expo-router';
import { Loading } from '../components/ui';
import { useAuth } from '../lib/auth';
import { configured } from '../lib/supabase';

export default function Index() {
  const { loading, session, isAdmin, fleet } = useAuth();
  if (!configured) return <Loading error="Supabase is not configured. Copy .env.example to .env.local and set EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY." />;
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/auth/sign-in" />;
  if (isAdmin) return <Redirect href="/admin" />;
  if (fleet) return <Redirect href="/(owner)" />;
  return <Redirect href="/onboarding" />;
}
