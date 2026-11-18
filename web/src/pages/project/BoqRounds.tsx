// ④ 내역서 › 기성 — 매달 기성 청구 서류 만들기 (현장 승인 수량 → 금회 수량 → 청구 금액)
//   계산: 적산 엔진 progressSheet(전회까지 · 금회 · 누계), 항목 금액은 수량 × 단가 원 미만 버림
//   기성금 = 도급액 × 금회 직접공사비 ÷ 도급 직접공사비 (원 미만 버림) — 원가계산 요율이 엑셀에만 있어서 비율로 나눔
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { q, sb } from '../../lib/supabase';
import { won, qty as fq, today } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Pill, Modal, Bar } from '../../lib/ui';
import { toSheet, type BoqItem } from '../../lib/boqSheet';
import { leafAmt, leaves, prevQty, q3, remap, roundAmounts, rowMap, rowsOf, total, type QtyMap } from '../../lib/boqProgress';
import { fetchItems } from './BoqChange';
import { QtyInput } from './BoqPhase';

const nospace = (s?: string | null) => (s || '').replace(/\s+/g, '');
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const monthEnd = (d: string) => { const x = new Date(d + 'T00:00:00'); return new Date(Date.UTC(x.getFullYear(), x.getMonth() + 1, 0)).toISOString().slice(0, 10); };
const ratioAmt = (contract: number, part: number, whole: number) => (whole ? Math.trunc((contract * part) / whole) : 0);

export default function BoqRounds({ pid, base, canEdit, isAdmin }: { pid: string; base: any; canEdit: boolean; isAdmin: boolean }) {
  const toast = useToast();
  const items = useLoad(() => fetchItems(base.id), [base.id]);
  const rounds = useLoad(() => q<any[]>(sb.from('boq_rounds').select('*').eq('project_id', pid).order('seq')), [pid]);
  // 예전 기준 내역서(설계변경 전)로 만든 회차가 있으면 그 항목도 받아 행 번호를 옮김
  const otherIds = [...new Set((rounds.data || []).map((r) => r.revision_id).filter((id) => id !== base.id))];
  const others = useLoad(async () => Object.fromEntries(await Promise.all(otherIds.map(async (id) => [id, await fetchItems(id)] as const))), [otherIds.join(',')]);
  const [selId, setSelId] = useState<string | null>(null);
  const [edit, setEdit] = useState<QtyMap | null>(null);
  const [meta, setMeta] = useState<{ title: string; period_from: string; period_to: string } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [find, setFind] = useState('');
  const [onlyCur, setOnlyCur] = useState(false);
  const [imp, setImp] = useState(false);
  const [busy, setBusy] = useState(false);
  const sheet = useMemo(() => (items.data ? toSheet(items.data) : null), [items.data]);

  if (items.loading || rounds.loading || others.loading) return <Loading />;
  const err = items.error || rounds.error || others.error;
  if (err) return <ErrorBox msg={err} />;
  if (!sheet) return null;

  const list = rounds.data || [];
  const maps: QtyMap[] = list.map((r) => (r.revision_id === base.id ? r.qty || {} : remap(r.qty || {}, rowMap((others.data || {})[r.revision_id] || [], items.data || []))));
  const idx = Math.max(0, list.findIndex((r) => r.id === selId) >= 0 ? list.findIndex((r) => r.id === selId) : list.length - 1);
  const cur = list[idx];
  const draft = cur && cur.status !== 'confirmed';
  const editable = canEdit && draft && cur.revision_id === base.id;
  const curMap = edit ?? maps[idx] ?? {};
  const allMaps = maps.map((m, i) => (i === idx ? curMap : m));
  const whole = total(sheet);
  const contract = Number(base.totals?.contract || 0);
  const lastConfirmed = list.length && list[list.length - 1].status === 'confirmed';

  const newRound = async () => {
    const last = list[list.length - 1];
    const from = last?.period_to ? addDays(last.period_to, 1) : today().slice(0, 8) + '01';
    const n = (last?.seq || 0) + 1;
    try {
      const r = await q<any>(sb.from('boq_rounds').insert({ project_id: pid, revision_id: base.id, seq: n, title: `${n}회 기성`, period_from: from, period_to: monthEnd(from), qty: {} }).select().single());
      await rounds.reload(); setSelId(r.id); setEdit(null); setMeta(null); toast(`${n}회 기성을 만들었습니다`);
    } catch (e: any) { toast(e.message); }
  };

  if (!list.length) {
    return (
      <section className="card">
        <h2>기성</h2>
        <span className="sub">매달(또는 정한 기간마다) 한 일의 수량을 넣어 기성 금액을 냅니다. 기준은 ‘{base.title}’입니다. ⑦ 공정률에서 승인한 현장 수량을 불러올 수 있습니다.</span>
        {canEdit && <div className="row"><button className="btn pri" onClick={newRound}>1회 기성 만들기</button></div>}
      </section>
    );
  }

  const am = roundAmounts(sheet, allMaps, idx);
  const curPay = ratioAmt(contract, am.cur.t, whole.t);
  const cumPay = ratioAmt(contract, am.cum.t, whole.t);
  const prevPay = ratioAmt(contract, am.prev.t, whole.t);
  const m = meta ?? { title: cur.title, period_from: cur.period_from || '', period_to: cur.period_to || '' };
  const dirty = edit !== null || meta !== null;
  const over = leaves(sheet).filter((r) => q3(prevQty(allMaps, idx, r.line.id) + Number(curMap[r.line.id] || 0)) > r.line.qty + 1e-9);

  const save = async (status?: 'confirmed' | 'draft') => {
    setBusy(true);
    try {
      const body: any = status === 'draft' ? { status } : { ...m, period_from: m.period_from || null, period_to: m.period_to || null, qty: curMap, ...(status ? { status } : {}) };
      await q(sb.from('boq_rounds').update(body).eq('id', cur.id));
      setEdit(null); setMeta(null); await rounds.reload();
      toast(status === 'confirmed' ? `${cur.title}을(를) 확정했습니다` : status === 'draft' ? '확정을 취소했습니다' : '저장했습니다');
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  };
  const confirmIt = () => {
    if (over.length) { toast(`누계가 계약 수량을 넘는 항목이 ${over.length}개 있습니다`); return; }
    if (window.confirm(`'${m.title}'을(를) 확정할까요? 확정하면 수량을 고칠 수 없습니다 (관리자만 확정 취소).`)) save('confirmed');
  };
  const remove = async () => {
    if (!window.confirm(`'${cur.title}'을(를) 지울까요?`)) return;
    try { await q(sb.from('boq_rounds').delete().eq('id', cur.id)); setSelId(null); setEdit(null); setMeta(null); rounds.reload(); } catch (e: any) { toast(e.message); }
  };
  const moveBase = async () => {
    if (!window.confirm(`'${cur.title}'의 기준을 '${base.title}'로 옮길까요? 공종명 · 규격 · 단위가 같은 항목의 수량만 옮겨집니다.`)) return;
    try { await q(sb.from('boq_rounds').update({ revision_id: base.id, qty: maps[idx] }).eq('id', cur.id)); rounds.reload(); toast('옮겼습니다'); } catch (e: any) { toast(e.message); }
  };
  const setQty = (id: string, v: number) => { const n = { ...curMap }; if (v) n[id] = v; else delete n[id]; setEdit(n); };

  const rows = rowsOf(sheet);
  const byId = new Map(rows.map((r) => [r.line.id, r]));
  const visible = onlyCur ? rows.filter((r) => !r.line.children && curMap[r.line.id])
    : find.trim() ? rows.filter((r) => !r.line.children && (nospace(r.line.name) + nospace(r.line.spec)).includes(nospace(find)))
    : rows.filter((r) => r.ancestors.every((a) => open[a] ?? (byId.get(a)?.depth === 0)));
  // 공종 줄 금액 (전회 · 금회 · 누계)
  const gsum = (id: string, f: (lid: string, l: any) => number) => {
    const g = byId.get(id); if (!g) return 0;
    let s = 0; const walk = (ls: any[]) => { for (const l of ls) { if (l.children) walk(l.children); else s += f(l.id, l); } }; walk(g.line.children || []); return s;
  };
  const amtPrev = (id: string, l: any) => leafAmt(l, prevQty(allMaps, idx, id));
  const amtCur = (id: string, l: any) => leafAmt(l, Number(curMap[id] || 0));
  const amtCum = (id: string, l: any) => leafAmt(l, q3(prevQty(allMaps, idx, id) + Number(curMap[id] || 0)));

  return (
    <>
      <div className="row between">
        <div className="row">
          {list.map((r, i) => (
            <button key={r.id} className={'btn' + (i === idx ? ' pri' : '')} aria-pressed={i === idx} onClick={() => { if (dirty && !window.confirm('저장하지 않은 내용이 있습니다. 다른 회차로 갈까요?')) return; setSelId(r.id); setEdit(null); setMeta(null); }}>
              <Pill c={r.status === 'confirmed' ? 'green' : 'orange'}>{r.status === 'confirmed' ? '확정' : '작성 중'}</Pill> {r.title}
            </button>))}
          {canEdit && lastConfirmed ? <button className="btn" onClick={newRound}>+ 새 회차</button> : null}
        </div>
        <div className="row">
          {editable && <button className="btn" onClick={() => setImp(true)}>현장 승인 수량 불러오기</button>}
          {editable && <button className="btn" disabled={busy || !dirty} onClick={() => save()}>저장</button>}
          {editable && <button className="btn pri" disabled={busy} onClick={confirmIt}>확정</button>}
          {editable && idx === list.length - 1 && <button className="btn sm" onClick={remove}>지우기</button>}
          {!draft && isAdmin && idx === list.length - 1 && <button className="btn sm" onClick={() => window.confirm('확정을 취소할까요? 수량은 그대로 남습니다.') && save('draft')}>확정 취소</button>}
        </div>
      </div>

      {draft && cur.revision_id !== base.id && <div className="banner"><span style={{ flex: 1 }}>이 회차는 예전 기준 내역서로 만들었습니다. 지금 기준은 ‘{base.title}’입니다.</span>{canEdit && <button className="btn sm" onClick={moveBase}>지금 기준으로 옮기기</button>}</div>}

      <div className="grid g4">
        <div className="stat"><span className="l">금회 직접공사비</span><span className="v">{won(am.cur.t)}</span><span className="s">재료 {won(am.cur.m)} · 노무 {won(am.cur.l)} · 경비 {won(am.cur.e)}</span></div>
        <div className="stat" style={{ borderColor: 'var(--blue)', background: 'var(--blue-ll)' }}><span className="l">금회 기성금</span><span className="v">{won(curPay)}</span><span className="s">도급액 × 금회 직접공사비 비율</span></div>
        <div className="stat"><span className="l">누계 기성률</span><span className="v">{whole.t ? ((am.cum.t / whole.t) * 100).toFixed(1) : 0}%</span><span className="s"><Bar v={whole.t ? (am.cum.t / whole.t) * 100 : 0} teal /></span></div>
        <div className="stat"><span className="l">누계 기성금 · 잔여</span><span className="v">{won(cumPay)}</span><span className="s">전회까지 {won(prevPay)} · 잔여 {won(contract - cumPay)}</span></div>
      </div>
      {over.length > 0 && <div className="banner red">누계가 계약 수량을 넘는 항목이 {over.length}개 있습니다 (빨간 칸). 확정 전에 고치거나 설계변경으로 수량을 늘리세요.</div>}
      {dirty && <div className="banner"><span style={{ flex: 1 }}>바꾼 내용이 아직 저장되지 않았습니다.</span><button className="btn sm" onClick={() => { setEdit(null); setMeta(null); }}>되돌리기</button><button className="btn sm pri" disabled={busy} onClick={() => save()}>저장</button></div>}

      <section className="card flat">
        <div className="card-h" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-2)' }}>
          {editable ? (
            <div className="row">
              <input className="input" style={{ width: 150 }} value={m.title} onChange={(e) => setMeta({ ...m, title: e.target.value })} aria-label="회차 이름" />
              <input className="input" type="date" style={{ width: 160 }} value={m.period_from} onChange={(e) => setMeta({ ...m, period_from: e.target.value })} aria-label="기간 시작" />
              <span>~</span>
              <input className="input" type="date" style={{ width: 160 }} value={m.period_to} onChange={(e) => setMeta({ ...m, period_to: e.target.value })} aria-label="기간 끝" />
            </div>
          ) : <div className="row"><b>{cur.title}</b><span className="muted">{(cur.period_from || '').replace(/-/g, '.')} ~ {(cur.period_to || '').replace(/-/g, '.')}{cur.confirmed_at ? ` · ${cur.confirmed_at.slice(0, 10)} 확정` : ''}</span></div>}
          <div className="row">
            {!find && !onlyCur && <><button className="btn sm" onClick={() => setOpen(Object.fromEntries(rows.filter((r) => r.line.children).map((r) => [r.line.id, true])))}>모두 펼치기</button><button className="btn sm" onClick={() => setOpen({})}>접기</button></>}
            <button className={'btn sm' + (onlyCur ? ' pri' : '')} aria-pressed={onlyCur} onClick={() => setOnlyCur(!onlyCur)}>금회 있는 것만</button>
            <input className="input" style={{ width: 180 }} placeholder="공종 찾기" value={find} onChange={(e) => setFind(e.target.value)} aria-label="공종 찾기" />
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>공종명</th><th className="c">단위</th><th className="r">계약 수량</th><th className="r">전회까지</th><th className="r">금회</th><th className="r">누계</th><th className="r">금회 금액</th><th className="r">누계 금액</th><th>진행</th></tr></thead>
            <tbody>
              {visible.map((r) => {
                const l = r.line; const g = !!l.children;
                const isOpen = open[l.id] ?? r.depth === 0;
                if (g) {
                  const cum = gsum(l.id, amtCum), all = gsum(l.id, (_, x) => leafAmt(x, x.qty));
                  return (
                    <tr key={l.id} className="click" style={{ fontWeight: 600, background: r.depth === 0 ? 'var(--head)' : undefined }} onClick={!find && !onlyCur ? () => setOpen({ ...open, [l.id]: !isOpen }) : undefined}>
                      <td style={{ paddingLeft: 12 + r.depth * 16 }}>{!find && !onlyCur ? (isOpen ? '▾ ' : '▸ ') : ''}{l.name}</td><td></td><td className="r">{won(all)}</td><td className="r">{won(gsum(l.id, amtPrev))}</td><td></td><td></td>
                      <td className="r">{won(gsum(l.id, amtCur))}</td><td className="r">{won(cum)}</td><td className="muted">{all ? ((cum / all) * 100).toFixed(1) + '%' : ''}</td>
                    </tr>
                  );
                }
                const prev = q3(prevQty(allMaps, idx, l.id)); const now = Number(curMap[l.id] || 0); const cum = q3(prev + now);
                const isOver = cum > l.qty + 1e-9; const pct = l.qty ? (cum / l.qty) * 100 : 0;
                return (
                  <tr key={l.id}>
                    <td style={{ paddingLeft: 12 + (find || onlyCur ? 0 : r.depth * 16) }}>{l.name}{l.spec ? <span className="muted"> · {l.spec}</span> : null}</td>
                    <td className="c">{l.unit}</td><td className="r">{fq(l.qty)}</td><td className="r">{prev ? fq(prev) : ''}</td>
                    <td className="r"><QtyInput value={now} disabled={!editable} over={isOver} label={`${l.name} 금회 수량`} onCommit={(v) => setQty(l.id, v)} /></td>
                    <td className="r" style={isOver ? { color: 'var(--red)', fontWeight: 700 } : undefined}>{cum ? fq(cum) : ''}</td>
                    <td className="r">{now ? won(leafAmt(l, now)) : ''}</td><td className="r">{cum ? won(leafAmt(l, cum)) : ''}</td>
                    <td className="nw">{l.qty ? <><Bar v={pct} teal /> <span className="muted">{pct >= 100 - 1e-9 ? '완료' : pct.toFixed(1) + '%'}</span></> : ''}</td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={9} className="sub">{onlyCur ? '아직 금회 수량이 없습니다.' : '찾는 공종이 없습니다.'}</td></tr>}
            </tbody>
            <tfoot><tr><td>직접공사비</td><td></td><td className="r">{won(whole.t)}</td><td className="r">{won(am.prev.t)}</td><td></td><td></td><td className="r">{won(am.cur.t)}</td><td className="r">{won(am.cum.t)}</td><td></td></tr></tfoot>
          </table>
        </div>
        <div className="muted" style={{ padding: '8px 14px 12px' }}>금회 수량은 노란 칸에 넣습니다. 기준 내역서: {base.title} · 도급액 {won(contract)}원. 기성금 = 도급액 × 금회 직접공사비 ÷ 도급 직접공사비 (원 미만 버림).</div>
      </section>

      {imp && <FieldImport pid={pid} base={base} items={items.data || []} period={m} current={curMap}
        onClose={() => setImp(false)} onApply={(qty) => { setEdit({ ...curMap, ...qty }); setImp(false); toast('불러왔습니다. 저장을 눌러야 남습니다'); }} />}
    </>
  );
}

/* ---------- 현장 승인 수량 불러오기 (⑦ 공정률 공종 → 내역 항목) ---------- */
function FieldImport({ pid, base, items, period, current, onClose, onApply }: {
  pid: string; base: any; items: BoqItem[]; period: { period_from: string; period_to: string }; current: QtyMap;
  onClose: () => void; onApply: (qty: QtyMap) => void;
}) {
  const toast = useToast();
  const ok = !!(period.period_from && period.period_to);
  const data = useLoad(async () => {
    if (!ok) return null;
    const [works, links, entries] = await Promise.all([
      q<any[]>(sb.from('work_items').select('id, name, spec, unit').eq('project_id', pid).order('sort')),
      q<any[]>(sb.from('boq_work_links').select('*').eq('project_id', pid)),
      q<any[]>(sb.from('progress_entries').select('work_item_id, qty, status, daily_reports!inner(report_date)').eq('project_id', pid).in('status', ['approved', 'pending'])
        .gte('daily_reports.report_date', period.period_from).lte('daily_reports.report_date', period.period_to)),
    ]);
    return { works, links, entries };
  }, [pid, period.period_from, period.period_to]);
  const leafItems = items.filter((i) => i.section === 'detail' && (i.kind === 'item' || i.kind === 'link'));
  const guess = (w: any) => {
    const n = nospace(w.name);
    return leafItems.find((i) => nospace(i.name) === n && nospace(i.spec) === nospace(w.spec))
      || leafItems.find((i) => nospace(i.name) === n)
      || leafItems.find((i) => nospace(i.name).includes(n) || n.includes(nospace(i.name)));
  };
  const [pick, setPick] = useState<Record<string, string>>({});
  const [use, setUse] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const foot = <><button className="btn" onClick={onClose}>닫기</button><button className="btn pri" disabled={busy || !data.data} onClick={() => apply()}>{busy ? '넣는 중…' : '금회 수량에 넣기'}</button></>;
  if (!ok) return <Modal title="현장 승인 수량 불러오기" onClose={onClose}><span className="sub">회차 기간(시작 · 끝 날짜)을 먼저 넣어 주세요.</span></Modal>;
  if (data.loading) return <Modal title="현장 승인 수량 불러오기" onClose={onClose}><Loading /></Modal>;
  if (data.error || !data.data) return <Modal title="현장 승인 수량 불러오기" onClose={onClose}><ErrorBox msg={data.error || ''} /></Modal>;
  const { works, links, entries } = data.data;
  const sum = (wid: string, st: string) => entries.filter((e) => e.work_item_id === wid && e.status === st).reduce((s, e) => s + Number(e.qty), 0);
  const pending = entries.filter((e) => e.status === 'pending').length;
  const linkOf = new Map(links.filter((l) => l.revision_id === base.id).map((l) => [l.work_item_id, String(l.boq_row)]));
  const rowsW = works.map((w) => {
    const approved = q3(sum(w.id, 'approved'));
    const row = pick[w.id] ?? linkOf.get(w.id) ?? (guess(w) ? String(guess(w)!.row) : '');
    return { w, approved, row, on: use[w.id] ?? (approved > 0 && !!row) };
  }).filter((x) => x.approved > 0 || pick[x.w.id] !== undefined);

  async function apply() {
    const chosen = rowsW.filter((x) => x.on && x.row);
    if (!chosen.length) { toast('넣을 공종을 고르세요'); return; }
    setBusy(true);
    try {
      await q(sb.from('boq_work_links').upsert(chosen.map((x) => ({ work_item_id: x.w.id, project_id: pid, revision_id: base.id, boq_row: Number(x.row) })), { onConflict: 'work_item_id' }));
      const out: QtyMap = {};
      for (const x of chosen) out[x.row] = q3((out[x.row] || 0) + x.approved);
      onApply(out);
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  }

  return (
    <Modal title="현장 승인 수량 불러오기" onClose={onClose} foot={foot} wide>
      <p className="sub">{period.period_from.replace(/-/g, '.')} ~ {period.period_to.replace(/-/g, '.')} 작업일보에서 <b>승인된</b> 수량을 공종별로 더했습니다. 공종마다 내역서의 어느 항목인지 고르면, 그 항목의 금회 수량을 이 값으로 바꿉니다. 고른 연결은 다음 회차에도 그대로 씁니다.</p>
      {pending > 0 && <div className="banner">승인을 기다리는 현장 수량이 {pending}건 있습니다. 승인한 것만 들어갑니다. <Link to={`/projects/${pid}/progress`}>⑦ 공정률에서 승인하기</Link></div>}
      {rowsW.length === 0 ? <span className="sub">이 기간에 승인된 현장 수량이 없습니다.</span> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>넣기</th><th>공정률 공종</th><th className="r">승인 수량</th><th>내역서 항목</th><th className="r">지금 금회</th></tr></thead>
          <tbody>{rowsW.map(({ w, approved, row, on }) => {
            const it = leafItems.find((i) => String(i.row) === row);
            const unitDiff = it && w.unit && it.unit && nospace(w.unit) !== nospace(it.unit);
            return (
              <tr key={w.id}>
                <td><input type="checkbox" checked={on} onChange={(e) => setUse({ ...use, [w.id]: e.target.checked })} aria-label={w.name + ' 넣기'} style={{ width: 20, height: 20 }} /></td>
                <td><b>{w.name}</b>{w.spec ? <span className="muted"> · {w.spec}</span> : null}</td>
                <td className="r">{fq(approved)} {w.unit}</td>
                <td>
                  <select className="input" style={{ minWidth: 260 }} value={row} onChange={(e) => { setPick({ ...pick, [w.id]: e.target.value }); setUse({ ...use, [w.id]: !!e.target.value }); }} aria-label={w.name + ' 연결할 내역 항목'}>
                    <option value="">— 연결 안 함 —</option>
                    {leafItems.map((i) => <option key={i.row} value={i.row}>{i.name}{i.spec ? ` · ${i.spec}` : ''} ({i.unit})</option>)}
                  </select>
                  {unitDiff && <div className="muted" style={{ color: 'var(--red)' }}>단위가 다릅니다 (공종 {w.unit} / 내역 {it!.unit})</div>}
                </td>
                <td className="r">{row && current[row] ? fq(current[row]) : ''}</td>
              </tr>
            );
          })}</tbody>
        </table></div>)}
    </Modal>
  );
}
