import { useEffect, useState } from 'react';
import { api } from '../../lib/supabase';
import { useLicense } from '../../lib/license';
import { useToast, Loading, ErrorBox, Pill } from '../../lib/ui';
import { dt } from '../../lib/format';

const MODE: Record<string, [string, string]> = { normal: ['정상', 'green'], notice: ['미입금 알림', 'orange'], grace: ['유예', 'orange'], readonly: ['읽기 전용', 'red'], blocked: ['차단', 'red'] };
const k = (d?: string | null) => { if (!d) return '-'; const [y, m, dd] = d.split('-').map(Number); return `${y}년 ${m}월 ${dd}일`; };

export default function LicensePage() {
  const toast = useToast();
  const { reload } = useLicense();
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tok, setTok] = useState('');
  const load = () => api('/api/license/status').then(setS).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <ErrorBox msg={err} />;
  if (!s) return <Loading />;
  const m = MODE[s.mode] || [s.mode, ''];
  const run = async (fn: () => Promise<any>, ok: (r: any) => string) => { setBusy(true); try { const r = await fn(); toast(ok(r)); } catch (e: any) { toast(e.message); } await load(); await reload(); setBusy(false); };
  return (<>
    <div className="row between"><div><h1>라이선스</h1><p className="sub" style={{ margin: '4px 0 0' }}>WORKNIUM이 전자서명한 라이선스로만 사용 기한이 바뀝니다. 이 화면이나 DB에서 직접 고칠 수 없습니다.</p></div></div>
    <div className="grid g4">
      <div className="stat"><span className="l">상태</span><span className="v"><Pill c={m[1]}>{m[0]}</Pill></span>{s.tampered && <span className="s" style={{ color: 'var(--red)' }}>{s.tamper_note || '변조 확인 중'}</span>}</div>
      <div className="stat"><span className="l">사용 기한</span><span className="v" style={{ fontSize: 20 }}>{k(s.paid_until)}</span><span className="s">매월 10일까지 다음 달분 선불</span></div>
      <div className="stat"><span className="l">유예 · 읽기 전용</span><span className="s">유예 {k(s.grace_end)}까지<br />읽기 전용 {k(s.readonly_end)}까지{s.readonly_extra ? ` (백업 연장 ${s.readonly_extra}일)` : ''}</span></div>
      <div className="stat"><span className="l">마지막 확인</span><span className="v" style={{ fontSize: 16 }}>{s.last_check_at ? dt(s.last_check_at) : '아직 없음'}</span><span className="s">{s.last_check_ok === false ? <span style={{ color: 'var(--red)' }}>{s.last_error || '실패'}</span> : s.last_check_ok ? '성공 · 하루 1번 자동 확인' : ''}</span></div>
    </div>
    <section className="card">
      <h2>이 서버 정보</h2>
      <div className="facts">
        <div className="fact"><span className="k">고객사</span><span className="v">{s.customer_name || '(라이선스 서버에 아직 연결 안 됨)'}</span></div>
        <div className="fact"><span className="k">설치 번호</span><span className="v"><code style={{ userSelect: 'all' }}>{s.install_id}</code> <button className="btn sm" onClick={() => navigator.clipboard?.writeText(s.install_id).then(() => toast('복사했습니다'))}>복사</button></span></div>
        <div className="fact"><span className="k">프로그램 버전</span><span className="v">{s.version}{s.version === 'dev' && <span className="muted"> (개발판 — GitHub에서 받은 테스트 서버)</span>}</span></div>
        <div className="fact"><span className="k">라이선스 서버</span><span className="v">{s.configured ? '설정됨' : <span style={{ color: 'var(--red)' }}>설정 안 됨 — 서버 .env 의 LICENSE_URL · LICENSE_KEY</span>}</span></div>
      </div>
      {s.admin && <div className="row"><button className="btn pri" disabled={busy || !s.configured} onClick={() => run(() => api('/api/license/check-now', {}), (r) => (r.ok ? `확인했습니다 — 사용 기한 ${k(r.paid_until)}` : '확인 실패: ' + r.error))}>{busy ? '확인 중…' : '지금 확인'}</button>
        <span className="muted">입금 직후 바로 풀고 싶을 때 누르세요. 평소에는 하루 1번 자동으로 확인합니다.</span></div>}
    </section>
    {s.admin && <section className="card">
      <h2>라이선스 파일 붙여 넣기 (인터넷이 안 되는 서버)</h2>
      <p className="sub" style={{ margin: 0 }}>위의 <b>설치 번호</b>를 WORKNIUM에 알려 주면 이 서버 전용 라이선스 파일(GMLIC1.로 시작하는 글자)을 보내 드립니다. 다른 서버용 파일이나 고친 파일은 들어가지 않습니다.</p>
      <textarea className="input" rows={4} style={{ fontFamily: 'monospace', fontSize: 12 }} value={tok} onChange={(e) => setTok(e.target.value)} placeholder="GMLIC1.…" aria-label="라이선스 파일 내용" />
      <div className="row"><input type="file" accept=".lic,.txt" aria-label="라이선스 파일 고르기" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setTok((await f.text()).trim()); }} />
        <button className="btn pri" disabled={busy || !tok.trim().startsWith('GMLIC1.')} onClick={() => run(() => api('/api/license/upload', { token: tok }), (r) => `반영했습니다 — 사용 기한 ${k(r.paid_until)}`)}>올리기</button></div>
    </section>}
  </>);
}
