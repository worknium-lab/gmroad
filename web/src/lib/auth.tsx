import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { sb, q } from './supabase';

export type Profile = {
  id: string; username: string; name: string; company_id: string | null; role: string;
  emp_no?: string; dept?: string; rank?: string; position?: string; phone?: string; phone_public?: boolean;
  email?: string; address?: string; hire_date?: string; must_change_password: boolean; active: boolean;
};
export type Company = { id: string; code: string; name: string; biz_no?: string; ceo?: string; address?: string; sort: number };

type Ctx = {
  session: Session | null; profile: Profile | null; companies: Company[]; loading: boolean;
  company: string; setCompany: (id: string) => void; reload: () => Promise<void>;
  isAdmin: boolean; isSys: boolean; canEdit: boolean;
};
const C = createContext<Ctx>(null as any);
export const useAuth = () => useContext(C);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompanyState] = useState<string>(() => localStorage.getItem('gm.company') || 'all');
  const setCompany = (id: string) => { setCompanyState(id); localStorage.setItem('gm.company', id); };

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) { setProfile(null); setLoading(false); return; }
    try {
      const [p, cs] = await Promise.all([
        q<Profile>(sb.rpc('my_profile').single()),
        q<Company[]>(sb.from('companies').select('*').order('sort')),
      ]);
      setProfile(p); setCompanies(cs);
      import('./push').then((m) => m.syncPush());   // 켜 둔 기기면 지금 로그인한 사람으로 다시 등록
    } catch { setProfile(null); }
    setLoading(false);
  }, []);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => load(data.session));
    const { data } = sb.auth.onAuthStateChange((ev, s) => { if (ev !== 'TOKEN_REFRESHED') load(s); });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const role = profile?.role || '';
  return (
    <C.Provider value={{
      session, profile, companies, loading, company, setCompany,
      reload: async () => { const { data } = await sb.auth.getSession(); await load(data.session); },
      isSys: role === 'system_admin', isAdmin: role === 'system_admin' || role === 'company_admin',
      canEdit: ['system_admin', 'company_admin', 'staff'].includes(role),
    }}>{children}</C.Provider>
  );
}
