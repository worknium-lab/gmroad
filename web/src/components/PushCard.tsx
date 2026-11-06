import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb, q } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/ui';
import { PushState, pushState, enablePush, disablePush, testPush, deviceName } from '../lib/push';
import { dt } from '../lib/format';

const IOS_HELP = '아이폰 · 아이패드는 사파리에서 [공유 ⬆︎] → [홈 화면에 추가]로 앱을 깐 뒤, 홈 화면의 앱으로 열어야 알림을 받을 수 있습니다 (iOS 16.4 이상).';

/** 짧은 안내 (현장 앱 · 알림함 위): 아직 안 켠 기기에서만 보임 */
export function PushNudge({ teal }: { teal?: boolean }) {
  const toast = useToast();
  const [st, setSt] = useState<PushState | null>(null);
  const [hide, setHide] = useState(() => sessionStorage.getItem('gm.pushNudge') === 'x');
  useEffect(() => { pushState().then(setSt).catch(() => setSt('unsupported')); }, []);
  if (hide || !st || st === 'on' || st === 'unsupported') return null;
  const close = () => { sessionStorage.setItem('gm.pushNudge', 'x'); setHide(true); };
  return (
    <div className={'banner ' + (teal ? 'teal' : 'blue')} role="status">
      <span style={{ flex: 1, minWidth: 200 }}>
        <b>🔔 폰 잠금화면으로 알림 받기</b><br />
        {st === 'ios-install' ? IOS_HELP : st === 'denied' ? '이 기기에서 알림이 차단되어 있습니다. 브라우저 설정 › 사이트 설정 › 알림에서 허용해 주세요.' : '본사 요청 · 회의 할 일 · 필독 공지가 오면 바로 알려 드립니다.'}
      </span>
      {st === 'off' && <button className={'btn ' + (teal ? 'teal' : 'pri')} onClick={async () => { try { await enablePush(); toast('이 기기에서 알림을 받습니다'); setSt('on'); } catch (e: any) { toast(e.message); setSt(await pushState()); } }}>알림 켜기</button>}
      <Link className="btn sm" to="/me#push">자세히</Link>
      <button className="btn sm" onClick={close} aria-label="오늘은 그만 보기">닫기</button>
    </div>
  );
}

/** 내 정보 › 알림 설정 */
export function PushCard() {
  const { profile } = useAuth();
  const toast = useToast();
  const [st, setSt] = useState<PushState | null>(null);
  const [devs, setDevs] = useState<any[]>([]);
  const [quiet, setQuiet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState('');
  const load = async () => {
    const r = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
    setMine((await r?.pushManager?.getSubscription().catch(() => null))?.endpoint || '');
    setSt(await pushState().catch(() => 'unsupported' as PushState));
    setDevs(await q<any[]>(sb.from('push_subscriptions').select('id, endpoint, ua, last_ok_at, created_at').order('created_at')).catch(() => []));
    const p = await q<any>(sb.from('push_prefs').select('quiet_night').maybeSingle()).catch(() => null);
    setQuiet(!!p?.quiet_night);
  };
  useEffect(() => { load().then(() => { if (location.hash === '#push') document.getElementById('push')?.scrollIntoView({ behavior: 'smooth' }); }); }, []);
  const run = async (fn: () => Promise<any>, ok: string) => { setBusy(true); try { await fn(); toast(ok); } catch (e: any) { toast(e.message); } await load(); setBusy(false); };
  const setQuietNight = (v: boolean) => run(() => q(sb.from('push_prefs').upsert({ user_id: profile!.id, quiet_night: v, updated_at: new Date().toISOString() })), v ? '밤 10시 ~ 아침 7시에는 보내지 않습니다' : '밤에도 보냅니다');
  const label: Record<PushState, string> = { on: '켜짐', off: '꺼짐', denied: '차단됨', unsupported: '지원 안 함', 'ios-install': '앱 설치 필요' };

  return (
    <section className="card" id="push">
      <div className="card-h"><h2>앱 알림 (잠금화면)</h2>{st && <span className={'pill ' + (st === 'on' ? 'green' : st === 'off' ? '' : 'red')}>이 기기: {label[st]}</span>}</div>
      <p className="sub" style={{ margin: 0 }}>본사 자료요청, 회의 할 일, 필독 공지, 작업일보 제출 같은 알림이 폰 · PC 화면에 바로 뜹니다. 기기마다 따로 켜야 합니다. <span className="muted">지금 기기: {deviceName()}</span></p>
      {st === 'ios-install' && <div className="banner blue"><span>{IOS_HELP}</span></div>}
      {st === 'denied' && <div className="banner red"><span>이 기기 브라우저에서 이 사이트 알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠(또는 설정 › 사이트 설정 › 알림)에서 '허용'으로 바꾼 뒤 이 화면을 새로 고치세요.</span></div>}
      {st === 'unsupported' && <div className="banner"><span>이 브라우저는 알림을 지원하지 않습니다. 크롬 · 삼성 인터넷 · 엣지 · 사파리(홈 화면 앱)를 쓰세요.</span></div>}
      <div className="row">
        {st === 'off' && <button className="btn pri" disabled={busy} onClick={() => run(enablePush, '이 기기에서 알림을 받습니다')}>이 기기에서 알림 받기</button>}
        {st === 'on' && <><button className="btn pri" disabled={busy} onClick={() => run(async () => { const r = await testPush(); if (!r.sent) throw new Error('보내지 못했습니다. 잠시 뒤 다시 해 보세요'); }, '시험 알림을 보냈습니다 — 몇 초 안에 뜹니다')}>시험 알림 보내기</button>
          <button className="btn" disabled={busy} onClick={() => run(disablePush, '이 기기 알림을 껐습니다')}>이 기기 알림 끄기</button></>}
        <label className="row" style={{ gap: 6, marginLeft: 'auto' }}><input type="checkbox" checked={quiet} disabled={busy} onChange={(e) => setQuietNight(e.target.checked)} style={{ width: 18, height: 18 }} /> 밤 10시 ~ 아침 7시에는 알림 안 받기</label>
      </div>
      {devs.length > 0 && <>
        <h3 style={{ marginTop: 6 }}>알림 받는 기기 {devs.length}대</h3>
        {devs.map((d) => (
          <div key={d.id} className="row" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
            <span style={{ flex: 1 }}><b>{d.ua || '기기'}</b>{d.endpoint === mine && <span className="pill blue" style={{ marginLeft: 6 }}>지금 기기</span>} <span className="muted">등록 {dt(d.created_at)}{d.last_ok_at ? ` · 마지막 전송 ${dt(d.last_ok_at)}` : ''}</span></span>
            <button className="btn sm" disabled={busy} onClick={() => run(() => (d.endpoint === mine ? disablePush() : q(sb.from('push_subscriptions').delete().eq('id', d.id))), '이 기기로는 더 보내지 않습니다')}>빼기</button>
          </div>))}
      </>}
    </section>
  );
}
