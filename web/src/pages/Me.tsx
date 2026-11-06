import { useState } from 'react';
import { sb, q } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ROLE } from '../lib/format';
import { useToast } from '../lib/ui';
import ChangePassword from './ChangePassword';

export default function Me() {
  const { profile, companies, reload } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ name: profile?.name || '', phone: profile?.phone || '', phone_public: !!profile?.phone_public, email: profile?.email || '', address: profile?.address || '' });
  const [purpose, setPurpose] = useState('금융기관 제출용');
  const co = companies.find((c) => c.id === profile?.company_id);
  const save = async () => { try { await q(sb.from('profiles').update(f).eq('id', profile!.id)); toast('저장했습니다'); reload(); } catch (e: any) { toast(e.message); } };
  const print = () => {
    const w = window.open('', '_blank'); if (!w) return;
    const e = (v: any) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
    const d = new Date();
    w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>재직증명서</title><style>
      body{font-family:'Noto Sans KR',sans-serif;margin:0;padding:60px 70px;color:#1A2233}h1{text-align:center;letter-spacing:.5em;font-size:30px;margin:20px 0 48px}
      table{width:100%;border-collapse:collapse;font-size:15px}th,td{border:1px solid #8A94A6;padding:12px 14px;text-align:left}th{background:#F4F6F9;width:140px}
      p{text-align:center;font-size:16px;margin:56px 0 24px}.d{text-align:center;font-size:16px}.s{text-align:center;font-size:18px;font-weight:700;margin-top:64px}@page{size:A4;margin:0}</style></head><body>
      <h1>재직증명서</h1><table>
      <tr><th>성명</th><td>${e(profile?.name || '')}</td></tr><tr><th>사번</th><td>${e(profile?.emp_no || '')}</td></tr><tr><th>주소</th><td>${e(profile?.address || '')}</td></tr>
      <tr><th>소속 · 부서</th><td>${e(co?.name || '')} ${e(profile?.dept || '')}</td></tr><tr><th>직급 · 직책</th><td>${e([profile?.rank, profile?.position].filter(Boolean).join(' · '))}</td></tr>
      <tr><th>재직기간</th><td>${e(profile?.hire_date || '')} ~ 현재</td></tr><tr><th>용도</th><td>${e(purpose)}</td></tr></table>
      <p>위 사람은 당사에 재직하고 있음을 증명합니다.</p><div class="d">${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일</div>
      <div class="s">${e(co?.name || '')} &nbsp; 대표 ${e(co?.ceo || '')} &nbsp; (인)</div><div style="text-align:center;font-size:12px;color:#5B6577;margin-top:12px">${e(co?.address || '')}${co?.biz_no ? ' · 사업자번호 ' + e(co.biz_no) : ''}</div>
      <script>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
    sb.from('activity_log').insert({ user_id: profile!.id, action: '재직증명서 발급', target: purpose });
  };
  return (
    <>
      <h1>내 정보</h1>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="card"><div className="card-h"><h2>인사정보</h2><span className="muted">사번 · 직급 · 직책 · 부서는 관리자만 수정</span></div>
          <div className="form-grid">
            {[['아이디', profile?.username], ['역할', ROLE[profile?.role || '']], ['회사', co?.name], ['부서', profile?.dept], ['사번', profile?.emp_no], ['직급', profile?.rank], ['직책', profile?.position], ['입사일', profile?.hire_date]].map(([l, v]) =>
              <div key={l} className="field"><span>{l}</span><input aria-label={l} className="input" readOnly value={v || ''} /></div>)}
            <div className="field"><label htmlFor="m-n">이름</label><input id="m-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="m-e">이메일</label><input id="m-e" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="m-p">휴대폰</label><input id="m-p" className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
            <label className="check" style={{ marginTop: 22 }}><input type="checkbox" checked={f.phone_public} onChange={(e) => setF({ ...f, phone_public: e.target.checked })} />사내 연락처에 휴대폰 공개</label>
            <div className="field full"><label htmlFor="m-a">주소</label><input id="m-a" className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
          </div>
          <button className="btn pri" style={{ alignSelf: 'flex-end' }} onClick={save}>저장</button>
        </section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card"><h2>재직증명서 발급</h2>
            <div className="field"><label htmlFor="m-pu">용도</label><select id="m-pu" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{['금융기관 제출용', '관공서 제출용', '기타'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <button className="btn pri" onClick={print}>미리보기 · 인쇄 (PDF 저장 가능)</button>
            <span className="muted">인사정보와 관리자 › 회사 관리의 회사 정보가 들어갑니다. 발급 이력이 남습니다.</span>
          </section>
          <section className="card"><ChangePassword /></section>
          <button className="btn" onClick={() => sb.auth.signOut()}>로그아웃</button>
        </div>
      </div>
    </>
  );
}
