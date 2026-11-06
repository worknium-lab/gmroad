import { useMemo, useState } from 'react';
import { sb, q } from '../../lib/supabase';
import { loadStructure } from '../../lib/data';
import { signedUrls } from '../../lib/files';
import { useAuth } from '../../lib/auth';
import { today, dateK, dt, qty, won, REPORT, REQ, PHOTO_KINDS } from '../../lib/format';
import { useLoad, Loading, Pill, Empty, useSigned, useToast } from '../../lib/ui';

export default function Site({ pid }: { pid: string }) {
  const [sub, setSub] = useState<'daily' | 'photos' | 'drawings' | 'requests'>('daily');
  return (
    <>
      <div className="subtabs" role="tablist" aria-label="현장 현황">
        {([['daily', '작업일보'], ['photos', '사진'], ['drawings', '도면'], ['requests', '자료요청']] as const).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}</button>)}
      </div>
      {sub === 'daily' && <Daily pid={pid} />}
      {sub === 'photos' && <Photos pid={pid} />}
      {sub === 'drawings' && <Drawings pid={pid} />}
      {sub === 'requests' && <Requests pid={pid} />}
    </>
  );
}

function names(st: any) {
  const loc = new Map<string, string>(); st.facilities.forEach((f: any) => f.locations.forEach((l: any) => loc.set(l.id, `${f.name} › ${l.name}`)));
  const wk = new Map<string, any>(st.works.map((w: any) => [w.id, w]));
  return { loc, wk };
}

function Daily({ pid }: { pid: string }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [sel, setSel] = useState(today());
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }), []);
  const { data: list, reload: reloadList } = useLoad(() => q<any[]>(sb.from('daily_reports').select('report_date, status').eq('project_id', pid).gte('report_date', days[0])), [pid]);
  const { data: st } = useLoad(() => loadStructure(pid), [pid]);
  const { data: r, loading, reload } = useLoad(async () => {
    const rep = await q<any>(sb.from('daily_reports').select('*, daily_crews(*), daily_equipment(*), progress_entries(*), photos(*), material_moves(*, materials(name, unit)), submitter:profiles!daily_reports_submitted_by_fkey(name, username)').eq('project_id', pid).eq('report_date', sel).maybeSingle());
    return rep;
  }, [pid, sel]);
  const urls = useSigned((r?.photos || []).map((p: any) => p.storage_path));
  const status = new Map((list || []).map((x) => [x.report_date, x.status]));
  const nm = st ? names(st) : null;

  const setStatus = async (s: string) => {
    const reason = s === 'returned' ? prompt('수정 요청 사유') : null;
    if (s === 'returned' && !reason) return;
    try { await q(sb.from('daily_reports').update({ status: s, return_reason: reason }).eq('id', r.id)); toast(s === 'confirmed' ? '확인했습니다' : '수정 요청을 보냈습니다'); reload(); reloadList(); } catch (e: any) { toast(e.message); }
  };
  return (
    <>
      <section className="card" style={{ padding: 14 }}>
        <div className="row" style={{ flexWrap: 'nowrap', overflowX: 'auto', gap: 6 }}>
          {days.map((d) => { const s = status.get(d); const on = d === sel; return (
            <button key={d} aria-pressed={on} onClick={() => setSel(d)} style={{ flex: 'none', width: 64, height: 72, borderRadius: 10, border: on ? 0 : '1px solid var(--line)', background: on ? 'var(--teal)' : '#fff', color: on ? '#fff' : 'inherit', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <span style={{ fontSize: 11 }}>{dateK(d).split(' ')[1]}</span><b style={{ fontSize: 16 }}>{Number(d.slice(8))}</b>
              <span style={{ fontSize: 10, color: on ? '#fff' : s === 'draft' ? 'var(--orange-d)' : s ? 'var(--teal)' : 'transparent' }}>●</span></button>); })}
        </div>
      </section>
      {loading ? <Loading /> : !r ? <Empty>{dateK(sel)} 작업일보가 없습니다.</Empty> : (
        <>
          <div className="row between">
            <div className="row"><h2 style={{ fontSize: 20 }}>{dateK(sel)} 작업일보</h2><Pill c={REPORT[r.status][1]}>{REPORT[r.status][0]}</Pill>
              {r.submitted_at && <span className="muted">{dt(r.submitted_at)} · {r.submitter?.name || r.submitter?.username}</span>}{r.weather && <span className="muted">날씨 {r.weather}</span>}</div>
            {canEdit && r.status === 'submitted' && <div className="row"><button className="btn sm" onClick={() => setStatus('returned')}>수정 요청</button><button className="btn teal sm" onClick={() => setStatus('confirmed')}>본사 확인</button></div>}
          </div>
          {r.return_reason && r.status === 'returned' && <div className="banner red">수정 요청: {r.return_reason}</div>}
          <div className="grid g2">
            <section className="card"><h3>금일 공정 · 수량</h3>
              {r.work_note && <p style={{ margin: 0, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, whiteSpace: 'pre-line' }}>{r.work_note}</p>}
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>위치</th><th>공종</th><th className="r">금일</th><th>상태</th></tr></thead>
                <tbody>{r.progress_entries.map((e: any) => <tr key={e.id}><td>{nm?.loc.get(e.location_id)}</td><td>{nm?.wk.get(e.work_item_id)?.name}</td><td className="r"><b>{qty(e.qty)}</b> {nm?.wk.get(e.work_item_id)?.unit}</td>
                  <td><Pill c={e.status === 'approved' ? 'green' : e.status === 'rejected' ? 'red' : 'orange'}>{e.status === 'approved' ? '승인' : e.status === 'rejected' ? '반려' : '승인 대기'}</Pill></td></tr>)}</tbody></table></div>
              {!r.progress_entries.length && <span className="sub">수량 입력 없음</span>}
            </section>
            <section className="card"><h3>투입인원 · {r.daily_crews.reduce((s: number, c: any) => s + c.headcount, 0)}명</h3>
              <table className="tbl"><thead><tr><th>직종</th><th>소속</th><th className="r">인원</th></tr></thead>
                <tbody>{r.daily_crews.map((c: any) => <tr key={c.id}><td>{c.trade}</td><td className="sub">{c.company}</td><td className="r"><b>{c.headcount}</b></td></tr>)}</tbody></table></section>
            <section className="card"><h3>투입장비 · {r.daily_equipment.length}대</h3>
              <table className="tbl"><thead><tr><th>장비 · 규격</th><th>구분</th><th>시간</th><th>업체</th><th className="r">금액</th></tr></thead>
                <tbody>{r.daily_equipment.map((e: any) => <tr key={e.id}><td>{e.name} {e.spec}</td><td>{e.kind}</td><td>{e.hours}</td><td>{e.vendor}</td><td className="r">{won(e.amount)}</td></tr>)}</tbody></table></section>
            <section className="card"><h3>자재 · 사진 {r.photos.length}장</h3>
              {r.material_moves.map((m: any) => <div key={m.id} className="row between" style={{ padding: '8px 10px', background: 'var(--bg)', borderRadius: 8 }}><span>{m.materials?.name}</span><span>{m.kind === 'in' ? '반입' : '사용'} <b>{qty(m.qty)}</b> {m.materials?.unit}{m.invoice_path ? ' · 송장 ✓' : ''}</span></div>)}
              <div className="photo-grid">{r.photos.map((p: any) => <a key={p.id} className="photo" href={urls[p.storage_path]} target="_blank" rel="noreferrer">{urls[p.storage_path] && <img src={urls[p.storage_path]} alt={p.memo || p.kind} />}<span className="tag pill">{p.kind}</span></a>)}</div>
            </section>
          </div>
        </>)}
    </>
  );
}

function Photos({ pid }: { pid: string }) {
  const [loc, setLoc] = useState(''); const [kind, setKind] = useState(''); const [sel, setSel] = useState<any>(null);
  const { data: st } = useLoad(() => loadStructure(pid), [pid]);
  const { data, loading } = useLoad(() => {
    let qy = sb.from('photos').select('*, profiles(name, username)').eq('project_id', pid).order('taken_at', { ascending: false }).limit(300);
    if (loc) qy = qy.eq('location_id', loc); if (kind) qy = qy.eq('kind', kind);
    return q<any[]>(qy);
  }, [pid, loc, kind]);
  const urls = useSigned((data || []).map((p) => p.storage_path));
  const nm = st ? names(st) : null;
  const groups = useMemo(() => { const m = new Map<string, any[]>(); (data || []).forEach((p) => { const k = p.taken_at.slice(0, 10); m.set(k, [...(m.get(k) || []), p]); }); return [...m.entries()]; }, [data]);
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 320px)', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row">
          <select aria-label="위치" className="input" style={{ width: 200 }} value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">모든 위치</option>{st?.facilities.flatMap((f) => f.locations.map((l) => <option key={l.id} value={l.id}>{f.name} › {l.name}</option>))}</select>
          <select aria-label="구분" className="input" style={{ width: 140 }} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">모든 구분</option>{PHOTO_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <span className="sub">사진 {data?.length || 0}장</span>
        </div>
        {loading ? <Loading /> : !groups.length ? <Empty>사진이 없습니다. 현장 앱에서 올린 사진이 여기 모입니다.</Empty> : groups.map(([d, ps]) => (
          <section key={d} className="card"><h3>{dateK(d)} · {ps.length}장</h3>
            <div className="photo-grid">{ps.map((p) => <button key={p.id} className={'photo' + (sel?.id === p.id ? ' sel' : '')} onClick={() => setSel(p)} aria-label={p.memo || p.kind}>
              {urls[p.storage_path] && <img src={urls[p.storage_path]} alt="" />}<span className="tag pill">{p.kind}</span></button>)}</div>
          </section>))}
      </div>
      <aside className="card" aria-label="선택한 사진" style={{ position: 'sticky', top: 80 }}>
        {!sel ? <span className="sub">사진을 고르면 정보가 나옵니다.</span> : <>
          <a href={urls[sel.storage_path]} target="_blank" rel="noreferrer" className="photo" style={{ cursor: 'zoom-in' }}>{urls[sel.storage_path] && <img src={urls[sel.storage_path]} alt="" />}</a>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '70px 1fr', gap: 8, fontSize: 13 }}>
            <dt className="sub">촬영</dt><dd style={{ margin: 0 }}>{dt(sel.taken_at)}</dd>
            <dt className="sub">위치</dt><dd style={{ margin: 0 }}>{nm?.loc.get(sel.location_id) || '-'}</dd>
            <dt className="sub">공종</dt><dd style={{ margin: 0 }}>{nm?.wk.get(sel.work_item_id)?.name || '-'}</dd>
            <dt className="sub">구분</dt><dd style={{ margin: 0 }}>{sel.kind}</dd>
            <dt className="sub">GPS</dt><dd style={{ margin: 0 }}>{sel.lat ? `${sel.lat.toFixed(5)}, ${sel.lng.toFixed(5)}` : '-'}</dd>
            <dt className="sub">올린 사람</dt><dd style={{ margin: 0 }}>{sel.profiles?.name || sel.profiles?.username}</dd>
            <dt className="sub">메모</dt><dd style={{ margin: 0 }}>{sel.memo || '-'}</dd>
          </dl>
          <a className="btn sm" href={urls[sel.storage_path]} download>원본 받기</a></>}
      </aside>
    </div>
  );
}

function Drawings({ pid }: { pid: string }) {
  const { data, loading } = useLoad(() => q<any[]>(sb.from('documents').select('*').eq('project_id', pid).eq('category', 'drawing').order('file_name')), [pid]);
  const open = async (d: any) => { const u = await signedUrls([d.storage_path]); window.open(u[d.storage_path], '_blank'); };
  if (loading) return <Loading />;
  return (
    <section className="card"><h2>설계도면 ({data?.length || 0}장)</h2>
      {!data?.length ? <Empty>② 설계·계약서류 탭에서 설계도면을 올리면 여기와 현장 앱에 나타납니다.</Empty> : data.map((d) => (
        <button key={d.id} className="row between" onClick={() => open(d)} style={{ border: 0, borderTop: '1px solid var(--line-2)', background: 'none', padding: '12px 0', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
          <span>{d.file_name}</span><span className="muted">v{d.version} · {dt(d.created_at)}</span></button>))}
    </section>
  );
}

function Requests({ pid }: { pid: string }) {
  const { canEdit, profile } = useAuth();
  const toast = useToast();
  const { data, reload } = useLoad(async () => {
    const [reqs, members, st] = await Promise.all([
      q<any[]>(sb.from('requests').select('*, from:profiles!requests_from_user_fkey(name, username), to:profiles!requests_to_user_fkey(name, username)').eq('project_id', pid).order('created_at', { ascending: false })),
      q<any[]>(sb.from('project_members').select('user_id, profiles(name, username, role)').eq('project_id', pid)),
      loadStructure(pid),
    ]);
    return { reqs, members, st };
  }, [pid]);
  const [f, setF] = useState({ kind: '사진', title: '', body: '', location_id: '', due_at: '', to_user: '', remind: true });
  const send = async () => {
    if (!f.title.trim() || !f.to_user) return toast('제목과 받는 사람을 정해 주세요');
    try {
      await q(sb.from('requests').insert({ project_id: pid, kind: f.kind, title: f.title.trim(), body: f.body || null, location_id: f.location_id || null, due_at: f.due_at ? new Date(f.due_at).toISOString() : null, to_user: f.to_user, from_user: profile!.id, remind: f.remind }));
      toast('요청을 보냈습니다'); setF({ ...f, title: '', body: '' }); reload();
    } catch (e: any) { toast(e.message); }
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 400px)', alignItems: 'start' }}>
      <section className="card flat"><div className="tbl-wrap"><table className="tbl" style={{ minWidth: 640 }}>
        <thead><tr><th>요청</th><th>보낸 사람 → 받는 사람</th><th>마감</th><th>응답</th><th>상태</th></tr></thead>
        <tbody>{data?.reqs.map((r) => <tr key={r.id}><td><b>{r.title}</b><div className="muted">{r.kind}{r.body ? ' · ' + r.body : ''}</div></td>
          <td className="sub" style={{ fontSize: 13 }}>{r.from?.name || r.from?.username} → {r.to?.name || r.to?.username}</td>
          <td style={{ fontSize: 13, whiteSpace: 'nowrap', color: r.due_at && r.status !== 'done' && new Date(r.due_at) < new Date() ? 'var(--red)' : undefined }}>{r.due_at ? dt(r.due_at) : '-'}</td>
          <td style={{ fontSize: 13 }}>{r.answer_note || '-'}</td><td><Pill c={REQ[r.status][1]}>{REQ[r.status][0]}</Pill></td></tr>)}</tbody>
      </table></div>{!data?.reqs.length && <div style={{ padding: 20 }}><Empty>요청이 없습니다.</Empty></div>}</section>
      {canEdit && <section className="card"><h2>새 자료요청</h2>
        <div className="field"><label htmlFor="rk">종류</label><select id="rk" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['사진', '송장 · 계산서', '수량 확인', '서류', '기타'].map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="field"><label htmlFor="rt">제목</label><input id="rt" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="rl">위치</label><select id="rl" className="input" value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}><option value="">-</option>{data?.st.facilities.flatMap((fa) => fa.locations.map((l) => <option key={l.id} value={l.id}>{fa.name} › {l.name}</option>))}</select></div>
          <div className="field"><label htmlFor="rd">마감</label><input id="rd" type="datetime-local" className="input" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="rp">받는 사람</label><select id="rp" className="input" value={f.to_user} onChange={(e) => setF({ ...f, to_user: e.target.value })}><option value="">선택</option>{data?.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.name || m.profiles?.username}</option>)}</select></div>
        <div className="field"><label htmlFor="rb">내용</label><textarea id="rb" className="input" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
        <button className="btn pri" onClick={send}>요청 보내기</button>
        <span className="muted">받는 사람의 알림함과 현장 앱 알림에 바로 뜹니다.</span>
      </section>}
    </div>
  );
}
