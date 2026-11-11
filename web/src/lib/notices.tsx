// 워크니움 공지 — 로그인하면 팝업으로 뜸. 지난 공지는 알림 화면에서 다시 봄
//   '확인했습니다' · '오늘 하루 보지 않기'는 이 기기에만 저장 (워크니움으로 확인 기록을 보내지 않음)
import { useEffect, useState } from 'react';
import { sb, q } from './supabase';
import { useAuth } from './auth';
import { dt } from './format';
import { Modal, Pill } from './ui';

export type VNotice = { id: string; title: string; body: string; important: boolean; posted_at: string; ends_at: string | null };

const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const kOk = (uid: string) => `gm-vn-ok-${uid}`;
const kDay = (uid: string) => `gm-vn-day-${uid}`;
function read<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function write(k: string, v: any) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 되는 브라우저 */ } }

export const loadNotices = () => q<VNotice[]>(sb.from('vendor_notices').select('id, title, body, important, posted_at, ends_at').order('important', { ascending: false }).order('posted_at', { ascending: false }));

export function NoticeModal({ n, onClose, foot, pos }: { n: VNotice; onClose: () => void; foot?: React.ReactNode; pos?: string }) {
  return (
    <Modal title="워크니움 공지" onClose={onClose} foot={foot}>
      <div className="vn-head">{n.important && <Pill c="red">중요</Pill>}<h3 style={{ margin: 0, flex: 1 }}>{n.title}</h3>{pos && <span className="muted">{pos}</span>}</div>
      <span className="muted">{dt(n.posted_at)} · WORKNIUM</span>
      {n.body && <div className="vn-body">{n.body}</div>}
    </Modal>
  );
}

/** 로그인 직후 한 번 (그 뒤 10분마다 새 공지 확인) */
export function VendorNoticePopup() {
  const { profile } = useAuth();
  const [list, setList] = useState<VNotice[]>([]);
  const [i, setI] = useState(0);
  const uid = profile?.id || '';

  useEffect(() => {
    if (!uid) return;
    const pick = async () => {
      try {
        const all = await loadNotices();
        const ok: string[] = read(kOk(uid), []);
        const day: Record<string, string> = read(kDay(uid), {});
        const t = today();
        const show = all.filter((n) => !ok.includes(n.id) && day[n.id] !== t);
        setList((cur) => (cur.length ? cur : show));
      } catch { /* 공지 테이블이 아직 없으면 조용히 넘어감 */ }
    };
    pick();
    const tm = setInterval(pick, 10 * 60e3);
    return () => clearInterval(tm);
  }, [uid]);

  const n = list[i];
  if (!n) return null;
  const next = () => { if (i + 1 < list.length) setI(i + 1); else { setList([]); setI(0); } };
  const confirm = () => { const ok: string[] = read(kOk(uid), []); write(kOk(uid), [...new Set([...ok, n.id])].slice(-200)); next(); };
  const hideToday = () => { const day: Record<string, string> = read(kDay(uid), {}); const t = today(); const clean = Object.fromEntries(Object.entries(day).filter(([, v]) => v === t)); write(kDay(uid), { ...clean, [n.id]: t }); next(); };

  return <NoticeModal n={n} onClose={next} pos={list.length > 1 ? `${i + 1} / ${list.length}` : undefined}
    foot={<><button className="btn" onClick={hideToday}>오늘 하루 보지 않기</button><button className="btn pri" onClick={confirm}>확인했습니다</button></>} />;
}

/** 알림 화면 위쪽: 지금 보이는 워크니움 공지 다시 보기 */
export function NoticeList() {
  const [list, setList] = useState<VNotice[]>([]);
  const [open, setOpen] = useState<VNotice | null>(null);
  useEffect(() => { loadNotices().then(setList).catch(() => setList([])); }, []);
  if (!list.length) return null;
  return (
    <section className="card">
      <h2>워크니움 공지</h2>
      {list.map((n) => (
        <button key={n.id} onClick={() => setOpen(n)} className="row" style={{ border: 0, borderTop: '1px solid var(--line-2)', background: 'none', padding: '12px 0', textAlign: 'left', cursor: 'pointer', width: '100%', minHeight: 44 }}>
          {n.important && <Pill c="red">중요</Pill>}
          <b style={{ flex: 1 }}>{n.title}</b>
          <span className="muted">{dt(n.posted_at)}</span>
        </button>))}
      {open && <NoticeModal n={open} onClose={() => setOpen(null)} foot={<button className="btn pri" onClick={() => setOpen(null)}>닫기</button>} />}
    </section>
  );
}
