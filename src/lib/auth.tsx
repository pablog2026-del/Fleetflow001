import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { registerPushToken } from './push';
import { supabase } from './supabase';
import type { Membership, Organization } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  memberships: Membership[];
  isAdmin: boolean;
  /** the fleet this user owns (fleet-owner profile) */
  fleet: Organization | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: Session | null) => {
    if (!s) { setMemberships([]); return; }
    const { data } = await supabase.from('memberships').select('user_id, org_id, role, organizations(*)').eq('user_id', s.user.id);
    setMemberships((data ?? []) as unknown as Membership[]);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await load(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // defer: Supabase recommends not awaiting other calls inside this callback
      setTimeout(() => { load(s).finally(() => setLoading(false)); }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [load]);

  useEffect(() => {
    if (session) registerPushToken(session.user.id).catch(() => {});
  }, [session]);

  const value = useMemo<AuthState>(() => {
    const isAdmin = memberships.some((m) => m.role === 'admin' && m.organizations?.type === 'platform');
    const fleet = memberships.find((m) => m.organizations?.type === 'fleet')?.organizations ?? null;
    return {
      loading, session, memberships, isAdmin, fleet,
      refresh: () => load(session),
      signOut: async () => { await supabase.auth.signOut(); },
    };
  }, [loading, session, memberships, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
