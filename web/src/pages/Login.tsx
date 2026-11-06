import { FormEvent, useState } from 'react';
import { sb, idToEmail } from '../lib/supabase';

export default function Login() {
  const [id, setId] = useState(localStorage.getItem('gm.lastId') || '');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await sb.auth.signInWithPassword({ email: idToEmail(id), password: pw });
    setBusy(false);
    if (error) setErr(error.message.includes('Invalid') ? '아이디 또는 비밀번호가 맞지 않습니다.' : error.message);
    else localStorage.setItem('gm.lastId', id);
  };
  return (
    <div className="login">
      <section className="intro" aria-label="소개">
        <div><b style={{ fontSize: 22, color: '#fff' }}>GM 통합관리</b><div style={{ fontSize: 14, color: '#9DAAC0', marginTop: 4 }}>지엠로드 · 지엠알 · OO엔지니어링</div></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <h1>세 회사의 프로젝트와 현장을<br />한 곳에서 관리합니다</h1>
          <div className="feat" style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 15 }}>
            <span>① 설계도서 · 계약서류 · 공사 구성</span><span>② 현장 작업일보 · 사진 · 공정률 · 자재</span><span>③ 자료요청 · 알림</span>
          </div>
        </div>
        <span className="feat" style={{ fontSize: 12, color: '#8695AE' }}>PC · 태블릿 · 모바일에서 같은 계정으로 사용합니다.</span>
      </section>
      <div className="form">
        <form onSubmit={submit}>
          <h2 style={{ fontSize: 26 }}>로그인</h2>
          <div className="field"><label htmlFor="lid">아이디</label><input id="lid" className="input" style={{ height: 50 }} value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required /></div>
          <div className="field"><label htmlFor="lpw">비밀번호</label><input id="lpw" type="password" className="input" style={{ height: 50 }} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></div>
          {err && <div className="banner red" role="alert">{err}</div>}
          <button className="btn pri block" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
          <p className="sub" style={{ margin: 0, fontSize: 13 }}>계정이 없거나 비밀번호를 잊었으면 회사 관리자에게 요청하세요.</p>
        </form>
      </div>
    </div>
  );
}
