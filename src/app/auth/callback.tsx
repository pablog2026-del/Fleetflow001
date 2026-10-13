// Landing page for invite, magic-link, confirmation and password-reset emails.
// Web: supabase-js reads the tokens from the URL itself. Native: parse the deep link.
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Loading } from '../../components/ui';
import { supabase } from '../../lib/supabase';

export default function Callback() {
  const url = Linking.useLinkingURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const href = Platform.OS === 'web' ? window.location.href : url;
        if (!href) return;
        const u = new URL(href);
        const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
        const err = u.searchParams.get('error_description') ?? hash.get('error_description');
        if (err) throw new Error(err);
        const code = u.searchParams.get('code');
        const type = hash.get('type') ?? u.searchParams.get('type');
        if (code) {
          const { error: e } = await supabase.auth.exchangeCodeForSession(code);
          if (e) throw e;
        } else if (hash.get('access_token') && hash.get('refresh_token')) {
          const { error: e } = await supabase.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
          if (e) throw e;
        } else {
          // web: detectSessionInUrl may already have consumed the tokens
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error('This link is invalid or has expired.');
        }
        router.replace(type === 'invite' || type === 'recovery' ? '/auth/set-password' : '/');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [url]);

  return <Loading error={error} onRetry={error ? () => router.replace('/auth/sign-in') : undefined} />;
}
