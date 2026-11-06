import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb, q } from '../../lib/supabase';
import { useField } from './FieldShell';
import { dateK, today, won, REPORT } from '../../lib/format';
import { useToast, Pill } from '../../lib/ui';

const DEFAULT_TRADES = ['보통인부', '특별인부', '용접공', '신호수 · 안전'];

export default function FieldToday() {
  const { pid, report, ensureReport, reloadReport } = useField();
  const toast = useToast();
  const [crews, setCrews] = useState<any[]>([]);
  const [eqs, setEqs] = useState<any[]>([]);
  const [note, setNote] = useState(''); const [weather, setWeather] = useState('');
  const [counts, setCounts] = useState({ entries: 0, photos: 0, moves: 0 });
  const [eq, setEq] = useState({ name: '', spec: '', kind: '임대', hours: '', vendor: '', amount: '' });
  const locked = report && ['submitted', 'confirmed'].includes(report.status);

  const load = async () => {
    if (!report) { setCrews(DEFAULT_TRADES.map((t, i) => ({ trade: t, company: '', headcount: 0, sort: i }))); setEqs([]); setNote(''); setCounts({ entries: 0, photos: 0, moves: 0 }); return; }
    const [c, e, pe, ph, mm] = await Promise.all([
      q<any[]>(sb.from('daily_crews').select('*').eq('report_id', report.id).order('sort')),
      q<any[]>(sb.from('daily_equipment').select('*').eq('report_id', report.id).order('sort')),
      sb.from('progress_entries').select('id', { count: 'exact', head: true }).eq('report_id', report.id),
      sb.from('photos').select('id', { count: 'exact', head: true }).eq('project_id', pid).gte('created_at', today() + 'T00:00:00'),
      sb.from('material_moves').select('id', { count: 'exact', head: true }).eq('report_id', report.id),
    ]);
    setCrews(c.length ? c : DEFAULT_TRADES.map((t, i) => ({ trade: t, company: '', headcount: 0, sort: i })));
    setEqs(e); setNote(report.work_note || ''); setWeather(report.weather || '');
    setCounts({ entries: pe.count || 0, photos: ph.count || 0, moves: mm.count || 0 });
  };
  useEffect(() => { load(); }, [report?.id, pid]);

  const saveCrews = async (list = crews) => {
    const r = await ensureReport();
    await q(sb.from('daily_crews').delete().eq('report_id', r.id));
    const rows = list.filter((c) => c.trade.trim()).map((c, i) => ({ report_id: r.id, trade: c.trade, company: c.company || null, headcount: c.headcount, sort: i }));
    if (rows.length) await q(sb.from('daily_crews').insert(rows));
  };
  const saveNote = async () => { const r = await ensureReport(); await q(sb.from('daily_reports').update({ work_note: note, weather }).eq('id', r.id)); };
  const bump = (i: number, d: number) => { const n = crews.map((c, j) => (j === i ? { ...c, headcount: Math.max(0, c.headcount + d) } : c)); setCrews(n); saveCrews(n).catch((e) => toast(e.message)); };
  const addEq = async () => {
    if (!eq.name.trim()) return toast('장비명을 넣어 주세요');
    const r = await ensureReport();
    try { await q(sb.from('daily_equipment').insert({ report_id: r.id, ...eq, amount: Math.trunc(Number(eq.amount.replace(/\D/g, '')) || 0), sort: eqs.length })); setEq({ ...eq, name: '', spec: '', hours: '', amount: '' }); load(); } catch (e: any) { toast(e.message); }
  };
  const submit = async () => {
    try { await saveNote(); await saveCrews(); const r = await ensureReport(); await q(sb.from('daily_reports').update({ status: 'submitted' }).eq('id', r.id)); toast('작업일보를 제출했습니다. 본사에 알림이 갔습니다.'); reloadReport(); } catch (e: any) { toast(e.message); }
  };
  const total = crews.reduce((s, c) => s + c.headcount, 0);
  const st = report ? REPORT[report.status] : ['작성 전', ''];

  return (
    <>
      <div className="row between"><h1 style={{ fontSize: 20 }}>{dateK(today())} 작업일보</h1><Pill c={st[1]}>{st[0]}</Pill></div>
      {report?.status === 'returned' && <div className="banner red">본사 수정 요청: {report.return_reason}</div>}
      {locked && <div className="banner teal">제출했습니다. 고칠 게 있으면 본사에 수정 요청을 받아야 합니다.</div>}

      <section className="fcard">
        <h2>금일 공정 · 특이사항</h2>
        <div className="row" style={{ flexWrap: 'nowrap' }}><label htmlFor="wt" className="sub" style={{ whiteSpace: 'nowrap' }}>날씨</label>
          <input id="wt" className="input" placeholder="맑음 · 6℃/14℃" value={weather} disabled={locked} onChange={(e) => setWeather(e.target.value)} onBlur={() => saveNote().catch(() => {})} /></div>
        <textarea aria-label="금일 공정" className="input" rows={3} placeholder="예: P2 받침 교체, 무수축 모르타르 타설" value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} onBlur={() => saveNote().catch(() => {})} />
        <Link to="/field/qty" className="btn teal">공정률 수량 입력 · {counts.entries}건 ›</Link>
      </section>

      <section className="fcard">
        <div className="row between"><h2>투입인원</h2><b style={{ color: 'var(--teal)' }}>합계 {total}명</b></div>
        {crews.map((c, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap', borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
            <input aria-label="직종" className="input" style={{ flex: 1, height: 40 }} value={c.trade} disabled={locked} onChange={(e) => setCrews(crews.map((x, j) => (j === i ? { ...x, trade: e.target.value } : x)))} onBlur={() => saveCrews().catch(() => {})} />
            <div className="stepper"><button type="button" aria-label={c.trade + ' 빼기'} disabled={locked} onClick={() => bump(i, -1)}>−</button><b>{c.headcount}</b><button type="button" aria-label={c.trade + ' 더하기'} disabled={locked} onClick={() => bump(i, 1)}>+</button></div>
          </div>))}
        {!locked && <button className="btn sm" onClick={() => setCrews([...crews, { trade: '', company: '', headcount: 0 }])}>+ 직종 추가</button>}
        <span className="muted">노무비는 전자카드 기록으로 따로 계산하고, 여기 인원은 작업일보용입니다.</span>
      </section>

      <section className="fcard">
        <h2>투입장비 · {eqs.length}대</h2>
        {eqs.map((e) => <div key={e.id} className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
          <span><b>{e.name}</b> {e.spec} <Pill c={e.kind === '임대' ? 'orange' : 'blue'}>{e.kind}</Pill><div className="muted">{e.hours} · {e.vendor}</div></span>
          <span className="row"><span className="num">{won(e.amount)}</span>{!locked && <button className="link" onClick={async () => { await sb.from('daily_equipment').delete().eq('id', e.id); load(); }}>삭제</button>}</span></div>)}
        {!locked && <div className="form-grid">
          <input aria-label="장비명" className="input" placeholder="장비명 (크레인)" value={eq.name} onChange={(e) => setEq({ ...eq, name: e.target.value })} />
          <input aria-label="규격" className="input" placeholder="규격 (25t)" value={eq.spec} onChange={(e) => setEq({ ...eq, spec: e.target.value })} />
          <select aria-label="구분" className="input" value={eq.kind} onChange={(e) => setEq({ ...eq, kind: e.target.value })}><option>임대</option><option>직영</option></select>
          <input aria-label="시간" className="input" placeholder="시간 (08~17)" value={eq.hours} onChange={(e) => setEq({ ...eq, hours: e.target.value })} />
          <input aria-label="업체" className="input" placeholder="업체" value={eq.vendor} onChange={(e) => setEq({ ...eq, vendor: e.target.value })} />
          <input aria-label="금액" className="input num" inputMode="numeric" placeholder="금액" value={eq.amount} onChange={(e) => setEq({ ...eq, amount: e.target.value })} />
          <button className="btn full" onClick={addEq}>+ 장비 추가</button></div>}
      </section>

      <section className="fcard">
        <Link className="item" to="/field/photo"><span style={{ flex: 1 }}><b>사진</b><div className="muted">오늘 {counts.photos}장</div></span><span style={{ color: 'var(--teal)', fontWeight: 700 }}>{counts.photos ? '추가' : '찍기'} ›</span></Link>
        <Link className="item" to="/field/material" style={{ borderTop: '1px solid var(--line-2)' }}><span style={{ flex: 1 }}><b>자재반입 · 사용</b><div className="muted">오늘 {counts.moves}건</div></span><span style={{ color: 'var(--teal)', fontWeight: 700 }}>입력 ›</span></Link>
      </section>
      {!locked && <button className="btn teal block" onClick={submit}>작업일보 제출 → 본사 알림</button>}
    </>
  );
}
