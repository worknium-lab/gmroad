// 라이선스 단계 (DB가 날짜로 계산) — 화면 띠 · 차단 화면
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from './supabase';
import { useAuth } from './auth';

export type LicenseInfo = {
  mode: 'normal' | 'notice' | 'grace' | 'readonly' | 'blocked'; paid_until: string; customer_name: string | null; readonly_extra: number;
  tampered: boolean; grace_end: string; readonly_end: string; last_check_at: string | null; last_check_ok: boolean | null; install_id: string; today: string;
};
const C = createContext<{ info: LicenseInfo | null; reload: () => Promise<void> }>({ info: null, reload: async () => {} });
export const useLicense = () => useContext(C);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const reload = async () => { const { data } = await sb.rpc('license_info'); if (data) setInfo(data as LicenseInfo); };
  useEffect(() => { if (!session) return; reload(); const t = setInterval(reload, 10 * 60 * 1000); return () => clearInterval(t); }, [session]);
  return <C.Provider value={{ info, reload }}>{children}</C.Provider>;
}

const days = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 864e5);
const k = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${y}년 ${m}월 ${dd}일`; };

/** 상단 띠: 알림(관리자만) · 유예 · 읽기 전용 */
export function LicenseBanner() {
  const { info } = useLicense();
  const { isAdmin } = useAuth();
  if (!info || info.mode === 'normal' || info.mode === 'blocked') return null;
  if (info.mode === 'notice' && !isAdmin) return null;
  const to = <Link to="/admin/license" style={{ color: 'inherit', fontWeight: 700 }}>라이선스 보기 ›</Link>;
  if (info.mode === 'notice') return <div className="lic-band notice" role="status"><span>다음 달 사용료 입금이 확인되지 않았습니다. 사용 기한 <b>{k(info.paid_until)}</b> (매월 10일까지 선불)</span>{to}</div>;
  if (info.mode === 'grace') return <div className="lic-band grace" role="alert"><span><b>사용 기한이 지났습니다 (유예 {days(info.today, info.paid_until)}일째).</b> {k(info.grace_end)}까지 쓸 수 있고, 그다음 날부터 <b>읽기 전용</b>으로 바뀝니다. 관리자에게 알려 주세요.</span>{isAdmin && to}</div>;
  return <div className="lic-band ro" role="alert"><span><b>읽기 전용 기간</b>{info.tampered ? ' (프로그램 · 라이선스 변조 확인 중)' : ''} — 보기 · 엑셀 내려받기 · 백업만 됩니다. {!info.tampered && <>{k(info.readonly_end)}까지 데이터를 백업하세요. </>}</span>{isAdmin && to}</div>;
}

/** 차단 화면 (관리자는 라이선스 화면으로 갈 수 있음) */
export function LicenseBlocked() {
  const { isAdmin } = useAuth();
  const { info } = useLicense();
  return (
    <div className="spin" style={{ flexDirection: 'column', gap: 14, textAlign: 'center', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>사용이 중지되었습니다</h1>
      <p className="sub" style={{ maxWidth: 440, margin: 0 }}>라이선스 사용 기간{info ? `(${k(info.paid_until)})` : ''}과 백업 기간이 끝났습니다. 데이터는 이 서버에 그대로 보관되어 있으며, 사용료가 확인되면 바로 다시 열립니다.</p>
      {isAdmin ? <Link className="btn pri" to="/admin/license">라이선스 확인 · 파일 올리기</Link> : <p className="muted">회사 관리자에게 문의하세요.</p>}
      <button className="link" onClick={() => import('./push').then((m) => m.logout())}>로그아웃</button>
    </div>
  );
}
