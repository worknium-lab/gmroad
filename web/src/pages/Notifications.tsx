import { PushNudge } from '../components/PushCard';
import { useNavigate } from 'react-router-dom';
import { sb, q } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { dt } from '../lib/format';
import { useLoad, Loading, Empty } from '../lib/ui';

export default function Notifications() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const { data, loading, reload } = useLoad(() => q<any[]>(sb.from('notifications').select('*').eq('user_id', profile!.id).order('created_at', { ascending: false }).limit(100)), [profile?.id]);
  const open = async (n: any) => { if (!n.read_at) await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); if (n.link) nav(n.link); else reload(); };
  const readAll = async () => { await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', profile!.id).is('read_at', null); reload(); };
  if (loading) return <Loading />;
  return (
    <>
      <div className="row between"><h1>알림</h1><button className="btn sm" onClick={readAll}>모두 읽음</button></div>
      <PushNudge />
      <section className="card">
        {!data?.length ? <Empty>알림이 없습니다.</Empty> : data.map((n) => (
          <button key={n.id} onClick={() => open(n)} className="row" style={{ border: 0, borderTop: '1px solid var(--line-2)', background: 'none', padding: '12px 0', textAlign: 'left', cursor: 'pointer', width: '100%' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: n.read_at ? 'transparent' : 'var(--orange)' }} />
            <div style={{ flex: 1 }}><b style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</b><div className="muted">{n.body}</div></div>
            <span className="muted">{dt(n.created_at)}</span>
          </button>))}
      </section>
    </>
  );
}
