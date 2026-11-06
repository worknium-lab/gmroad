// 자료실: 홍보자료 · 카탈로그 · 기술자료 · 양식함, 같은 이름 = 새 버전, 사내 전용 / 외부 공유(기한 있는 링크)
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { q, sb } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { dt } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Pill, Modal, FileDrop, Seg } from '../../lib/ui';
import { FOLDERS, SUBFOLDERS, spaceDownload, spaceUpload, kb, extOf } from '../../lib/space';

const TY: Record<string, [string, string]> = { PDF: ['#FDECEA', '#A1271A'], MP4: ['#EDE5F7', '#5E3591'], MOV: ['#EDE5F7', '#5E3591'], PPTX: ['#FFF1E0', '#8A4B00'], PPT: ['#FFF1E0', '#8A4B00'], HWPX: ['#E3ECF7', '#1F4E8C'], HWP: ['#E3ECF7', '#1F4E8C'], XLSX: ['#E3F2EC', '#0F6E4A'], XLS: ['#E3F2EC', '#0F6E4A'], DOCX: ['#E3ECF7', '#1F4E8C'], JPG: ['#EEF1F6', '#33415A'], PNG: ['#EEF1F6', '#33415A'], ZIP: ['#EEF1F6', '#33415A'] };
const Badge = ({ n }: { n: string }) => { const e = extOf(n); const c = TY[e] || ['#EEF1F6', '#33415A']; return <span style={{ flex: 'none', width: 48, textAlign: 'center', fontSize: 11, fontWeight: 700, padding: '8px 0', borderRadius: 8, background: c[0], color: c[1] }}>{e || '파일'}</span>; };

export default function Library() {
  const toast = useToast();
  const { companies, company, canEdit } = useAuth();
  const [folder, setFolder] = useState<string>('전체');
  const [sub, setSub] = useState('');
  const [find, setFind] = useState('');
  const [view, setView] = useState<'card' | 'list'>('list');
  const [sel, setSel] = useState<any>(null);
  const [up, setUp] = useState(false);
  const data = useLoad(() => q<any[]>(sb.from('library_files').select('*, profiles:uploaded_by(name, username)').order('created_at', { ascending: false })), []);
  const all = data.data || [];
  const latest = useMemo(() => all.filter((f) => f.is_latest), [all]);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error.includes('library') ? '자료실 표가 아직 없습니다. 서버에서 bash scripts/update.sh 를 실행해 주세요.' : data.error} />;
  const coName = (id?: string) => (id ? companies.find((c) => c.id === id)?.name : '공통') || '';
  const list = latest.filter((f) => (folder === '전체' || f.folder === folder) && (!sub || f.subfolder === sub) && (company === 'all' || !f.company_id || f.company_id === company)
    && (!find || (f.title + f.file_name + (f.note || '')).toLowerCase().includes(find.toLowerCase())));
  const count = (fd: string) => latest.filter((f) => fd === '전체' || f.folder === fd).length;
  const versions = sel ? all.filter((f) => f.folder === sel.folder && f.title.toLowerCase() === sel.title.toLowerCase() && (f.company_id || '') === (sel.company_id || '')).sort((a, b) => b.version - a.version) : [];
  const dl = (f: any) => spaceDownload(f.path, f.file_name).catch((e) => toast(e.message));

  return (
    <>
      <div className="row between"><h1>자료실</h1>{canEdit && <button className="btn pri" onClick={() => setUp(true)}>자료 올리기</button>}</div>
      <div className="story" style={{ gridTemplateColumns: '200px minmax(0, 1fr)' }}>
        <aside className="card" style={{ padding: 10, gap: 4 }}>
          {['전체', ...FOLDERS].map((fd) => (
            <div key={fd}>
              <button className={'btn' + (folder === fd && !sub ? ' pri' : '')} style={{ width: '100%', justifyContent: 'space-between', border: 0 }} onClick={() => { setFolder(fd); setSub(''); }}>{fd}<span className="muted" style={{ color: 'inherit' }}>{count(fd)}</span></button>
              {folder === fd && SUBFOLDERS[fd]?.map((s) => <button key={s} className={'btn sm' + (sub === s ? ' pri' : '')} style={{ width: '100%', border: 0, paddingLeft: 24, justifyContent: 'flex-start' }} onClick={() => setSub(sub === s ? '' : s)}>{s}</button>)}
            </div>))}
          <Link to="/me" className="muted" style={{ padding: 8 }}>재직증명서 바로 발급 ›</Link>
        </aside>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div className="row between">
            <input className="input" style={{ width: 260 }} placeholder="자료 찾기" value={find} onChange={(e) => setFind(e.target.value)} aria-label="자료 찾기" />
            <Seg label="보기" value={view} onChange={setView} items={[['list', '목록'], ['card', '카드']]} />
          </div>
          {!list.length && <div className="empty">자료가 없습니다.</div>}
          {view === 'list' ? (
            <section className="card flat"><div className="tbl-wrap"><table className="tbl">
              <thead><tr><th></th><th>이름</th><th>폴더</th><th>회사</th><th>공개</th><th className="r">버전</th><th>올린 때</th><th></th></tr></thead>
              <tbody>{list.map((f) => (
                <tr key={f.id} className="click" onClick={() => setSel(f)} style={{ background: sel?.id === f.id ? 'var(--blue-ll)' : undefined }}>
                  <td><Badge n={f.file_name} /></td><td><b>{f.title}</b><div className="muted">{f.file_name} · {kb(f.size_bytes)}</div></td>
                  <td className="sub">{f.folder}{f.subfolder ? ' › ' + f.subfolder : ''}</td><td>{coName(f.company_id)}</td>
                  <td>{f.visibility === 'external' ? <Pill c="teal">외부 공유 가능</Pill> : <Pill>사내 전용</Pill>}</td>
                  <td className="r">v{f.version}</td><td className="num">{dt(f.created_at)}</td>
                  <td><button className="btn sm" onClick={(e) => { e.stopPropagation(); dl(f); }}>받기</button></td></tr>))}</tbody>
            </table></div></section>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {list.map((f) => (
                <button key={f.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', border: sel?.id === f.id ? '1.5px solid var(--blue)' : undefined }} onClick={() => setSel(f)}>
                  <div className="row"><Badge n={f.file_name} /><Pill c={f.visibility === 'external' ? 'teal' : ''}>{f.visibility === 'external' ? '외부 공유' : '사내'}</Pill></div>
                  <b>{f.title}</b><span className="muted">{coName(f.company_id)} · v{f.version} · {kb(f.size_bytes)}</span>
                </button>))}
            </div>)}
        </div>
      </div>
      {sel && <FileDetail f={sel} versions={versions} coName={coName} onClose={() => setSel(null)} onChange={() => { data.reload(); }} onDownload={dl} />}
      {up && <Upload onClose={() => setUp(false)} onDone={() => { setUp(false); data.reload(); }} defFolder={folder === '전체' ? '홍보자료' : folder} defSub={sub} />}
    </>
  );
}

function FileDetail({ f, versions, coName, onClose, onChange, onDownload }: { f: any; versions: any[]; coName: (id?: string) => string; onClose: () => void; onChange: () => void; onDownload: (f: any) => void }) {
  const toast = useToast();
  const { canEdit, isAdmin, profile } = useAuth();
  const links = useLoad(() => (canEdit ? q<any[]>(sb.from('share_links').select('*').eq('file_id', f.id).order('created_at', { ascending: false })) : Promise.resolve([])), [f.id]);
  const [days, setDays] = useState<'7' | '30' | 'once'>('7');
  const [note, setNote] = useState('');
  const mine = f.uploaded_by === profile?.id || isAdmin;
  const url = (t: string) => `${location.origin}/api/share/${t}`;
  const make = async () => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(18))).map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');
    const exp = new Date(Date.now() + (days === '30' ? 30 : 7) * 864e5).toISOString();
    try {
      await q(sb.from('share_links').insert({ file_id: f.id, token, expires_at: exp, max_downloads: days === 'once' ? 1 : null, note: note || null }));
      await navigator.clipboard?.writeText(url(token)).catch(() => {});
      toast('링크를 만들고 복사했습니다'); setNote(''); links.reload();
    } catch (e: any) { toast(e.message); }
  };
  const setVis = async (v: string) => { try { await q(sb.from('library_files').update({ visibility: v }).eq('id', f.id)); onChange(); onClose(); } catch (e: any) { toast(e.message); } };
  const del = async (x: any) => {
    if (!confirm(`v${x.version}을(를) 지울까요?`)) return;
    try { await sb.storage.from('space-files').remove([x.path]); await q(sb.from('library_files').delete().eq('id', x.id)); onChange(); onClose(); } catch (e: any) { toast(e.message); }
  };
  return (
    <Modal title={f.title} onClose={onClose} wide>
      <div className="row"><Badge n={f.file_name} /><div><b>{f.file_name}</b><div className="muted">{f.folder}{f.subfolder ? ' › ' + f.subfolder : ''} · {coName(f.company_id)} · {kb(f.size_bytes)} · {f.profiles?.name || f.profiles?.username} · {dt(f.created_at)}</div></div>
        <button className="btn pri" style={{ marginLeft: 'auto' }} onClick={() => onDownload(f)}>내려받기</button></div>
      {f.note && <div style={{ whiteSpace: 'pre-wrap' }}>{f.note}</div>}
      <b>버전 {versions.length}개</b>
      <div className="tbl-wrap"><table className="tbl"><tbody>{versions.map((x) => (
        <tr key={x.id}><td>v{x.version}{x.is_latest && <Pill c="green">최신</Pill>}</td><td>{x.file_name}</td><td className="muted">{kb(x.size_bytes)}</td><td className="num">{dt(x.created_at)}</td>
          <td className="r"><button className="btn sm" onClick={() => onDownload(x)}>받기</button>{(x.uploaded_by === profile?.id || isAdmin) && <button className="btn sm" style={{ marginLeft: 4 }} onClick={() => del(x)}>지우기</button>}</td></tr>))}</tbody></table></div>
      <div className="row between"><b>공개 범위: {f.visibility === 'external' ? '외부 공유 가능' : '사내 전용'}</b>
        {mine && <button className="btn sm" onClick={() => setVis(f.visibility === 'external' ? 'internal' : 'external')}>{f.visibility === 'external' ? '사내 전용으로 바꾸기' : '외부 공유 가능으로 바꾸기'}</button>}</div>
      {f.visibility === 'external' && canEdit && <>
        <div className="row">
          <Seg label="링크 기한" value={days} onChange={setDays} items={[['7', '7일'], ['30', '30일'], ['once', '1회 내려받기']]} />
          <input className="input" style={{ width: 200 }} placeholder="받는 곳 (예: ○○감리단)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="받는 곳" />
          <button className="btn pri" onClick={make}>링크 만들기</button>
        </div>
        <div className="muted">로그인 없이 받을 수 있는 링크입니다. 지금은 테스트 서버(Tailscale)라 회사 밖 사람은 열 수 없고, 회사 서버로 옮긴 뒤 바깥에서도 열립니다.</div>
        {(links.data || []).map((l) => { const dead = l.revoked || new Date(l.expires_at) < new Date() || (l.max_downloads && l.downloads >= l.max_downloads); return (
          <div key={l.id} className="row between" style={{ opacity: dead ? 0.5 : 1 }}>
            <span className="num" style={{ fontSize: 13 }}>{l.note || '링크'} · {l.max_downloads ? '1회용' : `~${dt(l.expires_at)}`} · 받은 횟수 {l.downloads}{dead ? ' · 끝남' : ''}</span>
            {!dead && <span className="row"><button className="btn sm" onClick={() => navigator.clipboard?.writeText(url(l.token)).then(() => toast('복사했습니다'))}>복사</button>
              <button className="btn sm" onClick={() => q(sb.from('share_links').update({ revoked: true }).eq('id', l.id)).then(links.reload)}>취소</button></span>}
          </div>); })}
      </>}
    </Modal>
  );
}

function Upload({ onClose, onDone, defFolder, defSub }: { onClose: () => void; onDone: () => void; defFolder: string; defSub: string }) {
  const toast = useToast();
  const { companies, company } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [f, setF] = useState({ folder: defFolder, subfolder: defSub, company_id: company === 'all' ? '' : company, visibility: 'internal', note: '', title: '' });
  const [busy, setBusy] = useState('');
  const go = async () => {
    setBusy('올리는 중…');
    try {
      for (const fl of files) {
        const u = await spaceUpload('library', fl);
        await q(sb.from('library_files').insert({ folder: f.folder, subfolder: f.subfolder || null, title: (files.length === 1 && f.title.trim()) || fl.name.replace(/\.\w+$/, ''), company_id: f.company_id || null,
          visibility: f.visibility, path: u.path, file_name: fl.name, size_bytes: fl.size, mime: fl.type || null, note: f.note || null }));
      }
      toast(`${files.length}개 올렸습니다`); onDone();
    } catch (e: any) { toast(e.message); setBusy(''); }
  };
  return (
    <Modal title="자료 올리기" onClose={onClose} foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!files.length || !!busy} onClick={go}>{busy || '올리기'}</button></>}>
      <FileDrop multiple label={files.length ? files.map((x) => x.name).join(', ') : '파일을 끌어다 놓거나 눌러서 고르세요'} onFiles={setFiles} />
      {files.length === 1 && <div className="field"><label htmlFor="lt">자료 이름 <span className="muted">— 같은 폴더에 같은 이름이 있으면 새 버전으로 저장됩니다</span></label><input id="lt" className="input" placeholder={files[0].name.replace(/\.\w+$/, '')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="lf">폴더</label><select id="lf" className="input" value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value, subfolder: '' })}>{FOLDERS.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label htmlFor="ls">세부</label><select id="ls" className="input" value={f.subfolder} onChange={(e) => setF({ ...f, subfolder: e.target.value })}><option value="">-</option>{SUBFOLDERS[f.folder].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label htmlFor="lc">회사</label><select id="lc" className="input" value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}><option value="">공통</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <Seg label="공개 범위" value={f.visibility as any} onChange={(v: any) => setF({ ...f, visibility: v })} items={[['internal', '사내 전용'], ['external', '외부 공유 가능']]} />
      <div className="field"><label htmlFor="ln">설명 (선택)</label><textarea id="ln" className="input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
    </Modal>
  );
}
