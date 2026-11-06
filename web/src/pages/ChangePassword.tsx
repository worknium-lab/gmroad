import { FormEvent, useState } from 'react';
import { sb } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function ChangePassword({ forced }: { forced?: boolean }) {
  const { profile, reload } = useAuth();
  const [a, setA] = useState(''); const [b, setB] = useState('');
  const [err, setErr] = useState(''); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (a.length < 8) return setErr('비밀번호는 8자 이상으로 정해 주세요.');
    if (a !== b) return setErr('두 비밀번호가 다릅니다.');
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: a });
    if (!error) await sb.from('profiles').update({ must_change_password: false }).eq('id', profile!.id);
    setBusy(false);
    if (error) setErr(error.message); else { setOk(true); setA(''); setB(''); await reload(); }
  };
  const body = (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 400, width: '100%' }}>
      <h2 style={{ fontSize: forced ? 24 : 17 }}>{forced ? '처음 로그인 · 비밀번호 정하기' : '비밀번호 변경'}</h2>
      {forced && <p className="sub" style={{ margin: 0 }}>{profile?.username} 계정의 비밀번호를 정해 주세요. 다음부터는 이 비밀번호로 로그인합니다.</p>}
      <div className="field"><label htmlFor="p1">새 비밀번호 (8자 이상)</label><input id="p1" type="password" className="input" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="p2">한 번 더</label><input id="p2" type="password" className="input" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" /></div>
      {err && <div className="banner red" role="alert">{err}</div>}
      {ok && <div className="banner teal">비밀번호를 바꿨습니다.</div>}
      <button className="btn pri" disabled={busy}>저장</button>
      {forced && <button type="button" className="link" onClick={() => sb.auth.signOut()}>로그아웃</button>}
    </form>
  );
  return forced ? <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>{body}</div> : body;
}
