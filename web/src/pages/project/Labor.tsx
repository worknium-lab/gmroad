// ⑨ 노무비 — 전자카드 근무내역(엑셀) → 출역 확인 → 근로자 · 단가 → 노무비 명세서 → 근로계약서 → 엑셀(수식 포함)
import { useMemo, useState } from 'react';
import { api, q, sb } from '../../lib/supabase';
import { download, upload } from '../../lib/files';
import { dt } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Pill, Modal, Seg, FileDrop } from '../../lib/ui';
import C from '../../lib/laborCore';
import { logAction } from '../../lib/data';

type Rec = { name: string; birth: string; date: string; job: string; tin: string; tout: string; taps: number; override?: number | null };
type Worker = { name: string; birth: string; job: string; wage: number | null; ins: string; addr: string; tel: string; bank: string; acct: string };
const pad = (n: number) => String(n).padStart(2, '0');
const num = (n: any) => Number(n || 0).toLocaleString('ko-KR');
const won = (n: any) => (n ? Number(n).toLocaleString('ko-KR') : '-');
const wkey = (w: { name: string; birth: string }) => w.name + '|' + w.birth;
const FIELDS: [string, string][] = [['name', '성명'], ['birth', '생년월일'], ['date', '근무일자'], ['in', '출근'], ['out', '퇴근'], ['job', '직종']];

export default function Labor({ pid, p }: { pid: string; p: any }) {
  const toast = useToast();
  const data = useLoad(async () => {
    const [months, set, roster] = await Promise.all([
      q<any[]>(sb.from('labor_months').select('id, ym, locked, totals, output_path, output_at, source_name, updated_at').eq('project_id', pid).order('ym', { ascending: false })),
      q<any>(sb.from('labor_settings').select('*').eq('project_id', pid).maybeSingle()),
      q<any[]>(sb.from('labor_workers').select('*').eq('project_id', pid)),
    ]);
    return { months, set, roster };
  }, [pid]);
  const [sel, setSel] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error.includes('labor_') ? '노무비 표가 아직 없습니다. 서버에서 bash scripts/update.sh 를 실행해 주세요.' : data.error.includes('permission') ? '노무비 권한이 없습니다. ① 개요 › 참여자 · 권한에서 노무비 체크를 받아야 합니다.' : data.error} />;
  const d = data.data!;
  const cur = d.months.find((m) => m.id === sel) || d.months[0];

  return (
    <>
      <section className="card">
        <div className="card-h"><h2>월별 노무비</h2><button className="btn pri" onClick={() => setNewOpen(true)}>전자카드 내역 올리기</button></div>
        {!d.months.length && <span className="sub">아직 없습니다. 건설근로자 전자카드 시스템에서 내려받은 근무(출퇴근) 내역 엑셀을 올리세요.</span>}
        <div className="row">
          {d.months.map((m) => (
            <button key={m.id} className={'btn' + (cur?.id === m.id ? ' pri' : '')} aria-pressed={cur?.id === m.id} onClick={() => setSel(m.id)}>
              {m.ym.replace('-', '년 ')}월{m.locked ? ' 🔒' : ''}{m.totals?.net ? <span className="muted" style={{ color: 'inherit', marginLeft: 6 }}>{num(m.totals.net)}원</span> : null}
            </button>))}
        </div>
        <div className="muted">근로자 주소 · 연락처 · 계좌는 '노무비' 권한이 있는 사람만 봅니다.</div>
      </section>
      {cur && <MonthView key={cur.id} pid={pid} p={p} monthId={cur.id} set={d.set} roster={d.roster} onChange={data.reload} />}
      {newOpen && <NewMonth pid={pid} existing={d.months} onClose={() => setNewOpen(false)} onDone={(id) => { setNewOpen(false); setSel(id); data.reload(); toast('올렸습니다'); }} />}
    </>
  );
}

/* ---------- 전자카드 올리기 ---------- */
function NewMonth({ pid, existing, onClose, onDone }: { pid: string; existing: any[]; onClose: () => void; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [res, setRes] = useState<any>(null);
  const [ym, setYm] = useState('');
  const parse = async (path: string, map?: any, header_row?: number) => {
    setBusy('엑셀 읽는 중…'); setErr('');
    try { const r = await api('/api/labor/parse', { project_id: pid, path, map, header_row }); setRes(r); setYm((y) => (r.months.some((m: any) => m.ym === y) ? y : r.months[r.months.length - 1]?.ym || '')); }
    catch (e: any) { setErr(e.message); }
    setBusy('');
  };
  const pick = async (fs: File[]) => {
    const f = fs[0]; if (!f) return;
    setBusy('올리는 중…'); setErr('');
    try { const { path } = await upload(pid, 'labor/raw', f); setFile({ path, name: f.name }); await parse(path); } catch (e: any) { setErr(e.message); setBusy(''); }
  };
  const remap = (k: string, v: string) => { const map = { ...res.map }; if (v === '') delete map[k]; else map[k] = +v; parse(file!.path, map, res.header_row); };
  const save = async () => {
    const old = existing.find((m) => m.ym === ym);
    if (old?.locked) return setErr(`${ym}은(는) 확정되어 잠겨 있습니다. 잠금을 푼 뒤 올리세요`);
    if (old && !confirm(`${ym} 자료가 이미 있습니다. 새 파일로 바꿀까요? (직접 고친 공수는 지워집니다. 근로자 정보 · 단가는 그대로)`)) return;
    setBusy('저장 중…');
    try {
      const records = res.records.filter((r: Rec) => r.date.slice(0, 7) === ym);
      const row = { project_id: pid, ym, source_path: file!.path, source_name: file!.name, col_map: { map: res.map, header_row: res.header_row, sheet: res.sheet }, records, output_path: null, totals: {}, updated_at: new Date().toISOString() };
      const m = await q<any>(sb.from('labor_months').upsert(row, { onConflict: 'project_id,ym' }).select().single());
      onDone(m.id);
    } catch (e: any) { setErr(e.message); setBusy(''); }
  };
  const recs: Rec[] = res ? res.records.filter((r: Rec) => r.date.slice(0, 7) === ym) : [];
  return (
    <Modal title="전자카드 근무내역 올리기" onClose={onClose} wide
      foot={res ? <><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!!busy || !ym || !recs.length} onClick={save}>{ym ? `${ym.replace('-', '년 ')}월로 저장` : '저장'}</button></> : undefined}>
      <FileDrop accept=".xlsx,.xls,.csv" label={busy || (file ? `${file.name} · 다른 파일로 바꾸려면 누르세요` : '전자카드 근무내역 엑셀(.xlsx · .xls · .csv)을 끌어다 놓거나 눌러서 고르세요')} onFiles={pick} />
      <div className="muted">성명 · 생년월일 · 근무일자 · 출근/퇴근 열을 자동으로 찾습니다. 같은 사람이 같은 날 여러 번 찍은 기록은 첫 출근 · 마지막 퇴근으로 합칩니다.</div>
      {res && <>
        <div className="row">
          <label className="field" style={{ width: 220 }}><span>귀속월</span>
            <select className="input" value={ym} onChange={(e) => setYm(e.target.value)}>{res.months.map((m: any) => <option key={m.ym} value={m.ym}>{m.ym.replace('-', '년 ')}월 ({m.count}건)</option>)}</select></label>
          <Pill c="blue">시트 '{res.sheet}'</Pill><Pill>출역 {recs.length}건</Pill><Pill>근로자 {new Set(recs.map(wkey)).size}명</Pill>
          {recs.filter((r) => !r.tin || !r.tout).length > 0 && <Pill c="red">출퇴근 미태그 {recs.filter((r) => !r.tin || !r.tout).length}건</Pill>}
          {recs.filter((r) => r.taps > 1).length > 0 && <Pill c="orange">중복 태그 {recs.filter((r) => r.taps > 1).length}건 합침</Pill>}
        </div>
        <b>열 연결 <span className="muted">자동으로 찾았습니다. 다르면 바꾸세요</span></b>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
          {FIELDS.map(([k, l]) => <label key={k} className="field"><span>{l}</span>
            <select className="input" value={res.map[k] ?? ''} onChange={(e) => remap(k, e.target.value)}><option value="">— 없음 —</option>{res.heads.map((h: string, i: number) => <option key={i} value={i}>{h}</option>)}</select></label>)}
        </div>
        <div className="tbl-wrap"><table className="tbl"><thead><tr>{res.heads.map((h: string, i: number) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{res.sample.map((r: any[], i: number) => <tr key={i}>{res.heads.map((_: any, k: number) => <td key={k}>{String(r[k] ?? '')}</td>)}</tr>)}</tbody></table></div>
        <div className="muted">원본 앞부분 5줄입니다.</div>
      </>}
      {err && <div className="banner red"><span>{err}</span></div>}
    </Modal>
  );
}

/* ---------- 한 달 ---------- */
function MonthView({ pid, p, monthId, set, roster, onChange }: { pid: string; p: any; monthId: string; set: any; roster: any[]; onChange: () => void }) {
  const toast = useToast();
  const m = useLoad(() => q<any>(sb.from('labor_months').select('*').eq('id', monthId).single()), [monthId]);
  const [tab, setTab] = useState<'rec' | 'wk' | 'st' | 'ct'>('rec');
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [S0, setS0] = useState<any>(null);
  const [jobs, setJobs] = useState<{ job: string; wage: number }[] | null>(null);
  const [ros, setRos] = useState<Record<string, Worker> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [unlock, setUnlock] = useState(false);
  const [who, setWho] = useState('');
  const [ci, setCi] = useState(0);

  const month = m.data;
  const records: Rec[] = recs ?? month?.records ?? [];
  const S = useMemo(() => {
    const d = C.defaultSettings();
    const base = S0 ?? { site: p.name, project: p.name, company: '', ...(set?.settings || {}) };
    const x = { ...d, ...base, rates: { ...d.rates, ...(base.rates || {}) } };
    if (month) { x.year = +month.ym.slice(0, 4); x.month = +month.ym.slice(5, 7); }
    return x;
  }, [S0, set, month, p.name]);
  const jobRates = jobs ?? set?.job_rates ?? [];
  const rosterMap: Record<string, Worker> = ros ?? Object.fromEntries((roster || []).map((w) => [wkey(w), w]));
  const workers: Worker[] = useMemo(() => C.buildWorkers(records, Object.values(rosterMap)), [records, rosterMap]);
  const st = useMemo(() => (month ? C.computeStatement(S, records, workers, jobRates) : null), [S, records, workers, jobRates, month]);
  if (m.loading && !month) return <Loading />;
  if (m.error || !month) return <ErrorBox msg={m.error || '없음'} />;
  const locked = month.locked;
  const touch = () => setDirty(true);
  const setS = (k: string, v: any) => { setS0({ ...S, [k]: v }); touch(); };
  const setR = (k: string, v: number) => { setS0({ ...S, rates: { ...S.rates, [k]: v } }); touch(); };
  const setW = (w: Worker, x: Partial<Worker>) => {
    const k = wkey(w); const nw = { ...w, ...(rosterMap[k] || {}), ...x };
    const next = { ...rosterMap, [k]: nw };
    setRos(next); touch();
    if (x.job && !jobRates.some((j: any) => j.job === x.job)) setJobs([...jobRates, { job: x.job, wage: 0 }]);
  };
  const setOv = (r: Rec, v: string) => { setRecs(records.map((x) => (x === r ? { ...x, override: v === '' ? null : +v } : x))); touch(); };

  const save = async () => {
    setBusy('저장 중…');
    try {
      const { year, month: _m, ...settings } = S;
      await q(sb.from('labor_settings').upsert({ project_id: pid, settings, job_rates: jobRates, updated_at: new Date().toISOString() }));
      const rows = workers.map((w) => ({ project_id: pid, name: w.name, birth: w.birth, job: w.job || null, wage: w.wage === null || (w.wage as any) === '' ? null : Math.trunc(+w.wage), ins: w.ins || '자동',
        addr: w.addr || null, tel: w.tel || null, bank: w.bank || null, acct: w.acct || null, updated_at: new Date().toISOString() }));
      if (rows.length) await q(sb.from('labor_workers').upsert(rows, { onConflict: 'project_id,name,birth' }));
      if (recs) await q(sb.from('labor_months').update({ records: recs, updated_at: new Date().toISOString() }).eq('id', month.id));
      setDirty(false); setS0(null); setJobs(null); setRos(null); setRecs(null);
      await m.reload(); onChange(); toast('저장했습니다');
    } catch (e: any) { toast(e.message); }
    setBusy('');
  };
  const build = async () => {
    if (dirty) await save();
    setBusy('엑셀 만드는 중…');
    try { const r = await api('/api/labor/build', { month_id: month.id }); await m.reload(); onChange(); await download(r.path, `노무비_${S.site || p.name}_${month.ym}.xlsx`); toast('엑셀을 만들었습니다'); }
    catch (e: any) { toast(e.message); }
    setBusy('');
  };
  const confirmIt = async () => {
    if (!confirm(`${month.ym} 노무비를 확정하고 잠글까요? 잠금 해제는 비밀번호가 필요합니다.`)) return;
    try {
      if (dirty) await save();
      await q(sb.from('labor_months').update({ locked: true, confirmed_by: (await sb.auth.getUser()).data.user?.id, confirmed_at: new Date().toISOString() }).eq('id', month.id));
      await logAction(pid, '노무비 확정', month.ym);
      m.reload(); onChange(); toast('확정했습니다');
    } catch (e: any) { toast(e.message); }
  };
  const del = async () => {
    if (!confirm(`${month.ym} 노무비 자료를 지울까요? (근로자 정보 · 단가는 남습니다)`)) return;
    try { await q(sb.from('labor_months').delete().eq('id', month.id)); onChange(); } catch (e: any) { toast(e.message); }
  };

  const noOut = records.filter((r) => !r.tin || !r.tout).length;
  const zeroWage = st!.rows.filter((r: any) => !r.wage).length;
  const shownRecs = records.filter((r) => !who || wkey(r) === who);

  return (
    <section className="card">
      <div className="card-h">
        <h2>{month.ym.replace('-', '년 ')}월 노무비 {locked ? <Pill c="green">🔒 확정</Pill> : <Pill c="orange">작성 중</Pill>}</h2>
        <div className="row">
          {!locked && <button className={'btn' + (dirty ? ' pri' : '')} disabled={!dirty || !!busy} onClick={save}>{dirty ? '저장' : '저장됨'}</button>}
          <button className="btn pri" disabled={!!busy || zeroWage > 0} title={zeroWage ? '일급이 없는 근로자가 있습니다' : ''} onClick={build}>{busy || '엑셀 만들기 · 내려받기'}</button>
          {month.output_path && <button className="btn" onClick={() => download(month.output_path, `노무비_${S.site || p.name}_${month.ym}.xlsx`)}>지난 엑셀</button>}
          {!locked && <button className="btn" onClick={confirmIt}>확정</button>}
          {locked && <button className="btn" onClick={() => setUnlock(true)}>잠금 해제</button>}
          {!locked && <button className="btn sm" onClick={del}>지우기</button>}
        </div>
      </div>
      <div className="muted">원본: {month.source_name || '-'}{month.output_at ? ` · 엑셀 만든 때 ${dt(month.output_at)}` : ''}</div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {[['인원', st!.rows.filter((r: any) => r.nDays).length + '명'], ['총 공수', st!.sum.total.toFixed(1)], ['노무비 총액', num(st!.sum.amount) + '원'], ['공제 합계', num(st!.sum.ded) + '원'], ['차감 지급액', num(st!.sum.net) + '원']].map(([l, v], i) => (
          <div key={l} className="card" style={{ padding: 12, gap: 2, background: i === 4 ? 'var(--blue-l)' : undefined }}><span className="muted">{l}</span><b className="num">{v}</b></div>))}
      </div>
      {(noOut > 0 || zeroWage > 0) && <div className="banner"><span>{noOut > 0 && `퇴근(또는 출근) 태그가 없는 날 ${noOut}건은 0공수입니다 — 출역 확인에서 공수를 직접 넣으세요. `}{zeroWage > 0 && `일급이 없는 근로자 ${zeroWage}명 — 근로자 · 단가에서 직종 단가나 개인 일급을 넣으세요.`}</span></div>}

      <Seg label="단계" value={tab} onChange={setTab} items={[['rec', '1 출역 확인'], ['wk', '2 근로자 · 단가 · 설정'], ['st', '3 노무비 명세서'], ['ct', '4 근로계약서']]} />

      {tab === 'rec' && <>
        <div className="row">
          <select className="input" style={{ width: 220 }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="근로자 거르기"><option value="">근로자 전체</option>{workers.map((w) => <option key={wkey(w)} value={wkey(w)}>{w.name} ({w.birth})</option>)}</select>
          <span className="muted">공수 산정</span>
          <div className="seg" role="group" aria-label="공수 산정">{['출퇴근', '근무시간'].map((g) => <button key={g} className={S.gongsuMode === g ? 'on' : ''} disabled={locked} onClick={() => setS('gongsuMode', g)}>{g === '출퇴근' ? '출퇴근 태그 = 1공수' : '근무시간 기준'}</button>)}</div>
          {S.gongsuMode === '근무시간' && <span className="row" style={{ gap: 4 }}>1공수 <input className="input num" style={{ width: 64, height: 36 }} type="number" step="0.5" value={S.baseHours} disabled={locked} onChange={(e) => setS('baseHours', +e.target.value)} aria-label="1공수 시간" />시간 · 휴게 <input className="input num" style={{ width: 64, height: 36 }} type="number" step="0.5" value={S.breakHours} disabled={locked} onChange={(e) => setS('breakHours', +e.target.value)} aria-label="휴게 시간" />시간 차감</span>}
        </div>
        <div className="tbl-wrap" style={{ maxHeight: 560, overflow: 'auto' }}><table className="tbl">
          <thead><tr><th>근무일자</th><th>성명</th><th>생년월일</th><th>직종</th><th className="c">출근</th><th className="c">퇴근</th><th className="r">근무시간</th><th className="c">공수</th><th></th></tr></thead>
          <tbody>{shownRecs.map((r, i) => { const bad = !r.tin || !r.tout; return (
            <tr key={i} style={bad ? { background: '#FDECEA' } : undefined}>
              <td className="num">{r.date}</td><td>{r.name}</td><td className="num">{r.birth}</td><td>{r.job}</td>
              <td className="c num">{r.tin || '—'}</td><td className="c num">{r.tout || '—'}</td><td className="r num">{C.hoursOf(r, S).toFixed(2)}</td>
              <td className="c"><input className="input num" style={{ width: 76, height: 34, textAlign: 'right' }} type="number" step="0.5" min="0" disabled={locked} value={r.override ?? ''}
                placeholder={C.gongsuOf({ ...r, override: null }, S).toFixed(1)} onChange={(e) => setOv(r, e.target.value)} aria-label={`${r.date} ${r.name} 공수`} /></td>
              <td>{bad ? <Pill c="red">{!r.tout ? '퇴근 미태그' : '출근 미태그'}</Pill> : r.taps > 1 ? <Pill c="orange">태그 {r.taps}회</Pill> : null}</td>
            </tr>); })}</tbody></table></div>
        <div className="muted">공수 칸에 숫자를 넣으면 그날만 직접 정합니다 (엑셀에도 값으로 들어갑니다).</div>
      </>}

      {tab === 'wk' && <>
        <b>직종별 일급 <span className="muted">근로자별 일급을 비워 두면 이 단가를 씁니다</span></b>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          {jobRates.map((j: any, i: number) => <label key={i} className="field" style={{ width: 160 }}><span>{j.job || '(직종명)'}</span>
            <input className="input num" type="number" step="1000" disabled={locked} value={j.wage || ''} placeholder="일급" style={{ textAlign: 'right' }} onChange={(e) => { setJobs(jobRates.map((x: any, k: number) => (k === i ? { ...x, wage: +e.target.value || 0 } : x))); touch(); }} /></label>)}
          {!locked && <label className="field" style={{ width: 160 }}><span>직종 추가</span><input className="input" placeholder="직종명 입력 후 Enter" onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === 'Enter' && v && !jobRates.some((j: any) => j.job === v)) { setJobs([...jobRates, { job: v, wage: 0 }]); (e.target as HTMLInputElement).value = ''; touch(); } }} /></label>}
        </div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>성명</th><th>생년월일</th><th>직종</th><th className="r">일급(개인)</th><th className="r">적용 일급</th><th className="c">출역</th><th>연금 · 건강</th><th>주소</th><th>연락처</th><th>은행</th><th>계좌번호</th></tr></thead>
          <tbody>{st!.rows.map((r: any) => { const w = r.w as Worker; const inp = (k: keyof Worker, wd: number, ph = '') => <input className="input" style={{ height: 34, width: wd }} disabled={locked} value={(w[k] as any) ?? ''} placeholder={ph} onChange={(e) => setW(w, { [k]: e.target.value } as any)} aria-label={`${w.name} ${k}`} />; return (
            <tr key={wkey(w)}>
              <td><b>{w.name}</b></td><td className="num">{w.birth}</td>
              <td><input className="input" style={{ height: 34, width: 110 }} list="labor-jobs" disabled={locked} value={w.job || ''} onChange={(e) => setW(w, { job: e.target.value })} aria-label={`${w.name} 직종`} /></td>
              <td className="r"><input className="input num" style={{ height: 34, width: 110, textAlign: 'right' }} type="number" step="1000" disabled={locked} value={w.wage ?? ''} placeholder="직종 단가" onChange={(e) => setW(w, { wage: e.target.value === '' ? null : +e.target.value })} aria-label={`${w.name} 일급`} /></td>
              <td className="r num" style={{ color: r.wage ? undefined : 'var(--red-s)' }}>{r.wage ? num(r.wage) : '미입력'}</td><td className="c">{r.nDays}일</td>
              <td><select className="input" style={{ height: 34 }} disabled={locked} value={w.ins || '자동'} onChange={(e) => setW(w, { ins: e.target.value })} aria-label={`${w.name} 연금 건강`}>{['자동', '적용', '제외'].map((o) => <option key={o}>{o}</option>)}</select>{w.ins === '자동' || !w.ins ? <div className="muted">{r.ins ? '→ 적용' : '→ 제외'}</div> : null}</td>
              <td>{inp('addr', 200)}</td><td>{inp('tel', 120)}</td><td>{inp('bank', 80)}</td><td>{inp('acct', 140)}</td>
            </tr>); })}</tbody></table>
          <datalist id="labor-jobs">{jobRates.map((j: any) => <option key={j.job} value={j.job} />)}</datalist></div>
        <div className="muted">연금 · 건강 '자동'은 월 {S.rates.minDays}일 이상 출역하거나 월 {num(S.rates.minPay)}원 이상이면 적용합니다. 1개월 이상 근로 요건에 맞지 않으면 '제외'로 바꾸세요. 근로자 정보는 이 현장 명부에 남아 다음 달에도 그대로 씁니다.</div>
        <details className="card" style={{ padding: 14 }} open={!set}><summary><b>현장 · 사업주 · 근로조건 · 공제 요율</b> <span className="muted">엑셀 '설정' 시트로 들어가며, 엑셀에서 바꿔도 다시 계산됩니다</span></summary>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
            {([['site', '현장명'], ['project', '공사명'], ['siteAddr', '현장 주소'], ['company', '사업체명'], ['ceo', '대표자'], ['bizAddr', '사업장 주소'], ['bizTel', '전화'], ['workStart', '시업 시각'], ['workEnd', '종업 시각'], ['breakTime', '휴게시간'], ['holiday', '주휴일'], ['payDay', '임금지급일 (매월 ○일)']] as [string, string][]).map(([k, l]) =>
              <label key={k} className="field"><span>{l}</span><input className="input" disabled={locked} value={S[k] ?? ''} onChange={(e) => setS(k, k === 'payDay' ? +e.target.value : e.target.value)} /></label>)}
          </div>
          <b style={{ display: 'block', marginTop: 12 }}>공제 요율 (2026년 기준 — 해마다 확인)</b>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginTop: 6 }}>
            {([['emp', '고용보험 근로자 %', 1], ['pen', '국민연금 근로자 %', 1], ['hlt', '건강보험 근로자 %', 1], ['ltc', '장기요양 (건강보험료 대비) %', 1], ['taxDed', '일용근로소득 공제 (1일, 원)', 0], ['taxRate', '소득세율 %', 1], ['taxCredit', '근로소득세액공제율 %', 1], ['local', '지방소득세 (소득세 대비) %', 1], ['minTax', '소액부징수 기준 (1일, 원)', 0], ['minDays', '연금 · 건강 자동적용 최소 출역일수', 0], ['minPay', '연금 자동적용 월 소득기준 (원)', 0], ['penCap', '국민연금 기준소득월액 상한 (원)', 0]] as [string, string, number][]).map(([k, l, pct]) =>
              <label key={k} className="field"><span>{l}</span><input className="input num" type="number" step="any" disabled={locked} value={pct ? +(S.rates[k] * 100).toFixed(4) : S.rates[k]} onChange={(e) => setR(k, pct ? Math.round(+e.target.value * 1e6) / 1e8 : +e.target.value)} /></label>)}
          </div>
        </details>
      </>}

      {tab === 'st' && <Statement S={S} st={st} />}
      {tab === 'ct' && <Contracts S={S} st={st} i={Math.min(ci, st!.rows.length - 1)} setI={setCi} />}
      {unlock && <UnlockLabor month={month} onClose={() => setUnlock(false)} onDone={() => { setUnlock(false); m.reload(); onChange(); }} />}
    </section>
  );
}

function Statement({ S, st }: { S: any; st: any }) {
  const dows: number[] = []; for (let d = 1; d <= 31; d++) dows.push(d <= st.last ? new Date(Date.UTC(S.year, S.month - 1, d)).getUTCDay() : -1);
  const dc = (w: number) => (w === 0 ? 'sun' : w === 6 ? 'sat' : '');
  const g = (v: number) => (v ? (Number.isInteger(v) ? v.toFixed(1) : String(v)) : '');
  const money = ['tax', 'local', 'emp', 'pen', 'hlt', 'ltc', 'ded', 'net'];
  const mh = ['소득세', '지방소득세', '고용보험', '국민연금', '건강보험', '장기요양', '공제계', '차감지급액'];
  return (
    <>
      <div className="row between"><b>노무비 지급명세서 · {S.year}년 {S.month}월</b><span className="muted">{S.site}{S.project && S.project !== S.site ? ` (${S.project})` : ''} · {S.company}</span></div>
      <div className="tbl-wrap"><table className="lst">
        <thead>
          <tr><th rowSpan={2}>번호</th><th rowSpan={2} className="stk">성명</th><th rowSpan={2}>생년월일</th><th rowSpan={2}>직종</th>
            {dows.map((w, i) => <th key={i} className={dc(w)}>{w < 0 ? '' : i + 1}</th>)}
            <th rowSpan={2}>출역<br />일수</th><th rowSpan={2}>총<br />공수</th><th rowSpan={2}>일급</th><th rowSpan={2}>노무비<br />총액</th>{mh.map((h) => <th key={h} rowSpan={2}>{h}</th>)}<th rowSpan={2}>연금·<br />건강</th><th rowSpan={2}>은행</th><th rowSpan={2}>계좌번호</th></tr>
          <tr>{dows.map((w, i) => <th key={i} className={dc(w)}>{w < 0 ? '' : '일월화수목금토'[w]}</th>)}</tr>
        </thead>
        <tbody>
          {st.rows.map((r: any) => (
            <tr key={r.i}><td className="d">{r.i}</td><td className="stk">{r.w.name}</td><td>{r.w.birth}</td><td>{r.w.job}</td>
              {dows.map((w, i) => <td key={i} className="d">{w < 0 ? '' : g(r.days[i + 1])}</td>)}
              <td className="d">{r.nDays}</td><td className="d">{r.total.toFixed(1)}</td><td className="m">{won(r.wage)}</td><td className="m"><b>{won(r.amount)}</b></td>
              {money.map((k) => <td key={k} className="m">{k === 'net' ? <b>{won(r[k])}</b> : won(r[k])}</td>)}<td className="d">{r.ins ? 'Y' : 'N'}</td><td>{r.w.bank}</td><td>{r.w.acct}</td></tr>))}
          <tr className="sum"><td colSpan={2} className="stk">합계 (공수)</td><td /><td />{dows.map((w, i) => <td key={i} className="d">{w < 0 ? '' : g(st.sum.days[i + 1])}</td>)}
            <td className="d">{st.sum.nDays}</td><td className="d">{st.sum.total.toFixed(1)}</td><td /><td className="m">{won(st.sum.amount)}</td>{money.map((k) => <td key={k} className="m">{won(st.sum[k])}</td>)}<td /><td /><td /></tr>
          <tr className="sum"><td colSpan={2} className="stk">일별 출역인원</td><td /><td />{dows.map((w, i) => <td key={i} className="d">{w < 0 || !st.sum.heads[i + 1] ? '' : st.sum.heads[i + 1]}</td>)}<td colSpan={15} /></tr>
        </tbody>
      </table></div>
      <div className="muted">소득세 = 1일 소득세 × 출역일수 (1일 소득세 = (일평균 임금 − {num(S.rates.taxDed)}원) × {+(S.rates.taxRate * 100).toFixed(2)}% × (1 − {+(S.rates.taxCredit * 100).toFixed(0)}%), 10원 미만 절사, {num(S.rates.minTax)}원 미만 소액부징수). 4대보험은 10원 미만 절사. 엑셀에는 같은 계산이 모두 수식으로 들어갑니다.</div>
    </>
  );
}

const ymdK = (s: string) => { if (!s) return '     년     월     일'; const p = s.split('-'); return `${+p[0]}년 ${+p[1]}월 ${+p[2]}일`; };
function Contracts({ S, st, i, setI }: { S: any; st: any; i: number; setI: (i: number) => void }) {
  if (!st.rows.length) return <span className="sub">근로자가 없습니다.</span>;
  const r = st.rows[Math.max(0, i)], w = r.w;
  const ck = (b: boolean) => (b ? '☑' : '☐');
  const Row = ({ k, v, sub }: { k: string; v: any; sub?: boolean }) => <div className={'rowx' + (sub ? ' indent' : '')}><b>{k}</b><span>{v}</span></div>;
  return (
    <div className="ct-layout">
      <div className="ct-list">{st.rows.map((x: any, k: number) => <button key={k} className={'ct-item' + (k === i ? ' on' : '')} onClick={() => setI(k)}><span><b>{x.w.name}</b><br /><small>{x.w.job || '직종 미입력'}</small></span><small>{x.nDays}일</small></button>)}</div>
      <div className="paper-wrap"><div className="paper">
        <h1>건설일용근로자 표준근로계약서</h1><div className="rule" />
        <p>{S.company} (이하 "사업주"라 함)과(와) <b>{w.name}</b> (이하 "근로자"라 함)은(는) 다음과 같이 근로계약을 체결한다.</p>
        <Row k="1. 근로계약기간" v={`${ymdK(r.first)} 부터  ${ymdK(r.lastWork)} 까지`} />
        <Row k="2. 근 무 장 소" v={S.site + (S.siteAddr ? ` (${S.siteAddr})` : '')} />
        <Row k="3. 업무의 내용(직종)" v={w.job} />
        <Row k="4. 소정근로시간" v={`${S.workStart} ~ ${S.workEnd}  (휴게시간 : ${S.breakTime})`} />
        <Row k="5. 근무일 / 휴일" v={`현장 작업일정에 따라 근무 / 주휴일 : 매주 ${S.holiday}`} />
        <Row k="6. 임    금" v="" />
        <Row sub k="- 일급" v={num(r.wage) + ' 원'} /><Row sub k="- 상여금 / 기타수당" v="없음 / 없음" />
        <Row sub k="- 임금지급일" v={`매월 ${S.payDay}일 (휴일의 경우는 전일 지급)`} />
        <Row sub k="- 지급방법" v={'근로자 명의 예금통장에 입금' + (w.bank || w.acct ? ` (${w.bank} ${w.acct})` : '')} />
        <Row k="7. 연차유급휴가" v="근로기준법에서 정하는 바에 따라 부여함" />
        <Row k="8. 사회보험 적용여부" v={`☑ 고용보험   ☑ 산재보험   ${ck(r.ins)} 국민연금   ${ck(r.ins)} 건강보험`} />
        <Row k="9. 근로계약서 교부" v="사업주는 근로계약을 체결함과 동시에 본 계약서를 사본하여 근로자의 교부요구와 관계없이 근로자에게 교부함 (근로기준법 제17조 이행)" />
        <Row k="10. 기    타" v="이 계약에 정함이 없는 사항은 근로기준법령에 의함" />
        <div className="date">{ymdK(r.first)}</div>
        <div className="sign">
          <div><b>(사업주)</b><Row k="사업체명" v={S.company + (S.bizTel ? ` (전화 : ${S.bizTel})` : '')} /><Row k="주    소" v={S.bizAddr} /><Row k="대 표 자" v={`${S.ceo}     (서명)`} /></div>
          <div><b>(근로자)</b><Row k="주    소" v={w.addr} /><Row k="연 락 처" v={w.tel} /><Row k="성    명" v={`${w.name}     (서명)`} /><Row k="생년월일" v={w.birth} /></div>
        </div>
      </div></div>
      <div className="muted" style={{ flexBasis: '100%' }}>엑셀 '근로계약서' 시트에 근로자별로 한 장씩(A4) 들어갑니다.</div>
    </div>
  );
}

function UnlockLabor({ month, onClose, onDone }: { month: any; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const go = async () => { try { await api('/api/labor/unlock', { month_id: month.id, password: pw, reason }); onDone(); } catch (e: any) { setErr(e.message); } };
  return (
    <Modal title={`잠금 해제 · ${month.ym} 노무비`} onClose={onClose} foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!pw || !reason.trim()} onClick={go}>잠금 풀기</button></>}>
      <p className="sub">내역서 · 회의록과 같은 회사 잠금 해제 비밀번호입니다. 누가 · 언제 · 왜 풀었는지 기록됩니다.</p>
      <div className="field"><label htmlFor="lu1">비밀번호</label><input id="lu1" className="input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></div>
      <div className="field"><label htmlFor="lu2">사유</label><input id="lu2" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 근로자 계좌번호 수정" /></div>
      {err && <div className="banner red"><span>{err}</span></div>}
    </Modal>
  );
}
