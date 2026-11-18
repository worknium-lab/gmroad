// ④ 내역서 › 하도급 — 하도급 계약 금액 정하기 · 하도급 적정성(대상 대비 82%) 확인
//   업체마다: 하도급할 공종 고르기 → 단가 × 하도급율(원 미만 버림) → 원가계산서(이 공사 요율, 원도급사 부담 비목 빼기)
//   설계변경으로 기준 내역서가 바뀌면 같은 업체의 하도급 변경내역서를 새로 만듦
import { useMemo, useState } from 'react';
import { q, sb } from '../../lib/supabase';
import { won, qty as fq } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Pill, Modal } from '../../lib/ui';
import { toSheet, type BoqItem } from '../../lib/boqSheet';
import { rowsOf, total } from '../../lib/boqProgress';
import { defaultExclude, inferRates, ROUNDS, subCalc } from '../../lib/boqCost';
import { flatten, type CostKey, type RoundMode } from '../../lib/estimate';
import { costXSheet, downloadXlsx, subXSheet } from '../../lib/boqXlsx';
import { fetchItems } from './BoqChange';

const nospace = (s?: string | null) => (s || '').replace(/\s+/g, '');
const pctS = (v: number, d = 2) => (v * 100).toFixed(d) + '%';
const FAIR = 0.82; // 하도급 대상 대비 82% 미만이면 적정성 심사 대상 (건설산업기본법)
const COST_SHOW: [CostKey, string][] = [['A', '재료비'], ['B', '노무비'], ['C', '경비'], ['D', '순공사원가'], ['gen', '일반관리비'], ['profit', '이윤'], ['H', '공급가액'], ['vat', '부가가치세'], ['J', '합계 (부가세 포함)']];

type Draft = { rate: string; picks: Set<string>; exclude: Set<CostKey>; round: RoundMode; note: string };

export default function BoqSub({ pid, p, base, canEdit, isAdmin }: { pid: string; p: any; base: any; canEdit: boolean; isAdmin: boolean }) {
  const toast = useToast();
  const items = useLoad(() => fetchItems(base.id), [base.id]);
  const subs = useLoad(() => q<any[]>(sb.from('boq_subs').select('*').eq('project_id', pid).order('vendor').order('seq')), [pid]);
  const [selId, setSelId] = useState<string | null>(null);
  const [ed, setEd] = useState<Draft | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [find, setFind] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const sheet = useMemo(() => (items.data ? toSheet(items.data) : null), [items.data]);
  const inf = useMemo(() => (sheet && items.data ? inferRates(items.data, total(sheet)) : null), [sheet, items.data]);

  if (items.loading || subs.loading) return <Loading />;
  if (items.error || subs.error) return <ErrorBox msg={items.error || subs.error || ''} />;
  if (!sheet || !inf) return null;

  const list = subs.data || [];
  const contract = Number(base.totals?.contract || 0);
  const vendors: string[] = (p.project_subcontracts || []).map((x: any) => x.name).filter(Boolean);
  const cur = list.find((s) => s.id === selId) || list[list.length - 1];
  const latestOf = (v: string) => list.filter((s) => s.vendor === v).sort((a, b) => b.seq - a.seq)[0];

  const reload = async (id?: string) => { await subs.reload(); if (id) setSelId(id); setEd(null); };
  const create = async (vendor: string, rate: number) => {
    try {
      const seq = (latestOf(vendor)?.seq || 0) + 1;
      if (seq > 1) { toast('이미 있는 업체입니다. 설계변경 뒤라면 그 업체의 하도급내역서에서 ‘변경내역서 만들기’를 누르세요'); return; }
      const r = await q<any>(sb.from('boq_subs').insert({ project_id: pid, revision_id: base.id, vendor, seq: 1, title: `${vendor} 하도급내역서`, rate, picks: [], exclude: defaultExclude(inf.exclude), round: 'floor1000' }).select().single());
      setAdding(false); await reload(r.id); toast('만들었습니다. 하도급할 공종을 체크하세요');
    } catch (e: any) { toast(e.message); }
  };

  const top = (
    <div className="row between">
      <div className="row">
        {list.map((s) => (
          <button key={s.id} className={'btn' + (cur?.id === s.id ? ' pri' : '')} aria-pressed={cur?.id === s.id}
            onClick={() => { if (ed && !window.confirm('저장하지 않은 내용이 있습니다. 다른 하도급내역서로 갈까요?')) return; setSelId(s.id); setEd(null); }}>
            <Pill c={s.status === 'confirmed' ? 'green' : 'orange'}>{s.status === 'confirmed' ? '확정' : '작성 중'}</Pill> {s.vendor} · {s.seq === 1 ? '당초' : `${s.seq - 1}차 변경`}
          </button>))}
        {canEdit && <button className="btn" onClick={() => setAdding(true)}>+ 하도급내역서</button>}
      </div>
    </div>
  );
  const addModal = adding && <AddModal vendors={vendors} used={new Set(list.map((s) => s.vendor))} onClose={() => setAdding(false)} onAdd={create} />;

  if (!cur) {
    return (
      <>
        <section className="card">
          <h2>하도급</h2>
          <span className="sub">업체마다 하도급할 공종을 고르고 하도급율을 넣으면, 단가 × 하도급율로 하도급내역서와 원가계산서를 만들고 하도급 대상 대비 비율(82% 기준)을 보여 줍니다. 기준: ‘{base.title}’.</span>
          {canEdit && <div className="row"><button className="btn pri" onClick={() => setAdding(true)}>하도급내역서 만들기</button></div>}
        </section>
        {addModal}
      </>
    );
  }

  const saved: Draft = { rate: String(+(Number(cur.rate) * 100).toFixed(4)), picks: new Set((cur.picks || []).map(String)), exclude: new Set(cur.exclude || []), round: cur.round, note: cur.note || '' };
  const d = ed ?? saved;
  const onBase = cur.revision_id === base.id;
  const draft = cur.status !== 'confirmed';
  const editable = canEdit && draft && onBase;
  const rateN = Number(d.rate) / 100;
  const rateOk = rateN > 0 && rateN <= 1;
  const res = rateOk ? subCalc({ sheet, picks: d.picks, rate: rateN, rates: inf.rates, exclude: d.exclude, round: d.round }) : null;
  const prev = cur.seq > 1 ? list.find((s) => s.vendor === cur.vendor && s.seq === cur.seq - 1) : undefined;
  const projSub = (p.project_subcontracts || []).find((x: any) => nospace(x.name) === nospace(cur.vendor));
  const set = (patch: Partial<Draft>) => setEd({ ...d, ...patch });
  const isLatest = latestOf(cur.vendor)?.id === cur.id;
  const result = res ? { target: res.target.total, sub: res.sub.total, direct: res.sDirect.t, ratio: res.ratio, supply: res.sub.supply } : {};

  const save = async (status?: 'confirmed' | 'draft') => {
    if (status !== 'draft' && !rateOk) { toast('하도급율을 0 ~ 100% 사이로 넣어 주세요'); return; }
    setBusy(true);
    try {
      const body: any = status === 'draft' ? { status } : { rate: rateN, picks: [...d.picks], exclude: [...d.exclude], round: d.round, note: d.note || null, result, ...(status ? { status } : {}) };
      await q(sb.from('boq_subs').update(body).eq('id', cur.id));
      await reload(); toast(status === 'confirmed' ? '확정했습니다' : status === 'draft' ? '확정을 취소했습니다' : '저장했습니다');
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm(`'${cur.title}'을(를) 지울까요?`)) return;
    try { await q(sb.from('boq_subs').delete().eq('id', cur.id)); setSelId(null); reload(); } catch (e: any) { toast(e.message); }
  };
  const makeChange = async () => {
    if (!window.confirm(`'${base.title}' 기준으로 ${cur.vendor}의 하도급 변경내역서를 만들까요? 같은 공종(공종명 · 규격 · 단위가 같은 줄)과 같은 하도급율을 씁니다.`)) return;
    try {
      const old: BoqItem[] = await fetchItems(cur.revision_id);
      const map = rowMapAll(old, items.data || []);
      const picks = [...new Set((cur.picks || []).map((x: any) => map.get(String(x))).filter(Boolean))];
      const r = await q<any>(sb.from('boq_subs').insert({ project_id: pid, revision_id: base.id, vendor: cur.vendor, seq: cur.seq + 1, title: `${cur.vendor} 하도급 변경내역서 (${cur.seq}차)`, rate: cur.rate, picks, exclude: cur.exclude, round: cur.round }).select().single());
      await reload(r.id); toast(`만들었습니다. 옮긴 공종 ${picks.length} / ${(cur.picks || []).length}줄 — 설계변경 신규 항목은 직접 체크하세요`);
    } catch (e: any) { toast(e.message); }
  };
  const excel = async () => {
    if (!res) return;
    setBusy(true);
    try {
      const sub = `${cur.vendor} · 하도급율 ${+(rateN * 100).toFixed(4)}% · 기준 ${base.title} · ${cur.status === 'confirmed' ? '확정' : '작성 중'}`;
      await downloadXlsx(pid, `${cur.vendor}_하도급내역서`, [
        subXSheet({ title: cur.title, sub, target: res.targetLines, rate: rateN }),
        costXSheet(`${cur.title} · 원·하도급 원가계산서`, sub + ` · 대상 대비 ${pctS(res.ratio)}`, [['하도급 대상', res.target], ['하도급', res.sub]]),
      ]);
    } catch (e: any) { toast('엑셀 만들기 실패: ' + e.message); }
    setBusy(false);
  };
  const syncProject = async () => {
    if (!res || !projSub) return;
    if (!window.confirm(`프로젝트 정보의 ‘${projSub.name}’ 하도급액을 ${won(res.sub.total)}원으로 바꿀까요?`)) return;
    try { await q(sb.from('project_subcontracts').update({ amount: res.sub.total }).eq('project_id', pid).eq('name', projSub.name)); toast('바꿨습니다 (프로젝트 머리의 하도급액은 새로고침하면 바뀝니다)'); } catch (e: any) { toast(e.message); }
  };

  // 공종 고르기 표
  const rows = rowsOf(sheet);
  const byId = new Map(rows.map((r) => [r.line.id, r]));
  const subAmt = new Map(res ? flatten(res.subLines).map((r) => [r.line.id, r.amount.t]) : []);
  const picked = (id: string) => d.picks.has(id) || (byId.get(id)?.ancestors || []).some((a) => d.picks.has(a));
  const visible = find.trim() ? rows.filter((r) => (nospace(r.line.name) + nospace(r.line.spec)).includes(nospace(find)))
    : rows.filter((r) => r.ancestors.every((a) => open[a] ?? false));
  const toggle = (id: string) => {
    const n = new Set(d.picks);
    if (n.has(id)) n.delete(id);
    else {
      // 공종을 고르면 그 아래 따로 고른 줄은 정리
      n.add(id);
      for (const r of rows) if (r.ancestors.includes(id)) n.delete(r.line.id);
    }
    set({ picks: n });
  };
  const ratioOk = res ? res.ratio >= FAIR - 1e-9 : true;
  const calcSame = Math.abs(inf.calc.total - contract) < 1;

  return (
    <>
      {top}
      {!onBase && isLatest && <div className="banner"><span style={{ flex: 1 }}>설계변경으로 기준 내역서가 ‘{base.title}’(으)로 바뀌었습니다. 이 하도급내역서는 예전 기준이라 금액을 다시 계산하지 않습니다.</span>{canEdit && <button className="btn sm pri" onClick={makeChange}>하도급 변경내역서 만들기</button>}</div>}
      {!onBase && cur.result?.sub != null && (
        <div className="grid g4">
          <div className="stat"><span className="l">하도급 대상액 (확정 당시)</span><span className="v">{won(cur.result.target)}</span></div>
          <div className="stat"><span className="l">하도급 계약금액 (확정 당시)</span><span className="v">{won(cur.result.sub)}</span></div>
          <div className="stat"><span className="l">대상 대비</span><span className="v">{pctS(cur.result.ratio || 0)}</span></div>
          <div className="stat"><span className="l">하도급율</span><span className="v">{pctS(Number(cur.rate), 3)}</span></div>
        </div>)}

      {onBase && <>
        <div className="grid g4">
          <div className="stat"><span className="l">도급액 (기준)</span><span className="v">{won(contract)}</span><span className="s">{base.title}</span></div>
          <div className="stat"><span className="l">하도급 대상액</span><span className="v">{res ? won(res.target.total) : '-'}</span><span className="s">고른 공종 · 도급 단가 · 공급가액 천원 버림</span></div>
          <div className="stat" style={{ borderColor: 'var(--blue)', background: 'var(--blue-ll)' }}><span className="l">하도급 계약금액</span><span className="v">{res ? won(res.sub.total) : '-'}</span>
            <span className="s">{prev?.result?.sub != null && res ? `${prev.seq === 1 ? '당초' : `${prev.seq - 1}차 변경`} 대비 ${(res.sub.total - prev.result.sub > 0 ? '+' : '') + won(res.sub.total - prev.result.sub)}` : `도급 대비 ${res && contract ? pctS(res.sub.total / contract) : '-'}`}</span></div>
          <div className="stat" style={!ratioOk ? { borderColor: 'var(--red)' } : undefined}><span className="l">대상 대비 비율</span><span className="v" style={{ color: ratioOk ? undefined : 'var(--red)' }}>{res ? pctS(res.ratio) : '-'}</span>
            <span className="s">{res ? (ratioOk ? <Pill c="green">82% 이상</Pill> : <Pill c="red">82% 미만 · 적정성 심사 대상</Pill>) : ''}</span></div>
        </div>
        {!calcSame && <div className="banner">원가계산서에서 읽은 요율로 다시 계산한 도급액({won(inf.calc.total)})이 엑셀 도급액({won(contract)})과 {won(inf.calc.total - contract)}원 다릅니다. 엑셀에 이 프로그램이 모르는 비목이 있을 수 있습니다 — 하도급 원가계산서 금액도 그만큼 차이 날 수 있습니다.</div>}
        {ed && <div className="banner"><span style={{ flex: 1 }}>바꾼 내용이 아직 저장되지 않았습니다.</span><button className="btn sm" onClick={() => setEd(null)}>되돌리기</button><button className="btn sm pri" disabled={busy} onClick={() => save()}>저장</button></div>}

        <section className="card">
          <div className="card-h">
            <h2>{cur.title}</h2>
            <div className="row">
              {res && d.picks.size > 0 && <button className="btn" disabled={busy} onClick={excel}>엑셀 내려받기</button>}
              {editable && <button className="btn" disabled={busy || !ed} onClick={() => save()}>저장</button>}
              {editable && <button className="btn pri" disabled={busy || !d.picks.size} onClick={() => window.confirm('확정할까요? 확정하면 고칠 수 없습니다 (관리자만 확정 취소).') && save('confirmed')}>확정</button>}
              {editable && isLatest && <button className="btn sm" onClick={remove}>지우기</button>}
              {!draft && isAdmin && isLatest && <button className="btn sm" onClick={() => window.confirm('확정을 취소할까요?') && save('draft')}>확정 취소</button>}
              {projSub && res && Number(projSub.amount) !== res.sub.total && canEdit && <button className="btn sm" onClick={syncProject}>프로젝트 하도급액에 반영 (지금 {won(projSub.amount)})</button>}
            </div>
          </div>
          <div className="row">
            <label className="row" style={{ gap: 6 }}><span className="muted">하도급율</span>
              {editable ? <input className="qin" style={{ width: 90 }} inputMode="decimal" aria-label="하도급율" value={d.rate} onChange={(e) => set({ rate: e.target.value.replace(/[^\d.]/g, '') })} /> : <b>{d.rate}</b>}%</label>
            <label className="row" style={{ gap: 6 }}><span className="muted">공급가액 끝수</span>
              <select className="input" style={{ width: 150, height: 36 }} disabled={!editable} value={d.round} onChange={(e) => set({ round: e.target.value as RoundMode })} aria-label="공급가액 끝수">{ROUNDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <span className="muted">하도급 단가 = 도급 단가 × 하도급율 (재료 · 노무 · 경비 따로, 원 미만 버림) · 하도급 공급가액 = 대상 공급가액 × 하도급율</span>
          </div>
        </section>

        <div className="grid boq-cost">
          <section className="card flat">
            <div className="card-h" style={{ padding: '12px 14px' }}>
              <div className="row"><b>하도급할 공종</b><span className="muted">{d.picks.size ? `${d.picks.size}개 고름` : '체크해서 고르세요'} · 파란 줄 = 하도급</span></div>
              <div className="row">{!find && <><button className="btn sm" onClick={() => setOpen(Object.fromEntries(rows.filter((r) => r.line.children).map((r) => [r.line.id, true])))}>모두 펼치기</button><button className="btn sm" onClick={() => setOpen({})}>접기</button></>}
                <input className="input" style={{ width: 170 }} placeholder="공종 찾기" value={find} onChange={(e) => setFind(e.target.value)} aria-label="공종 찾기" /></div>
            </div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th></th><th>공종명</th><th className="c">단위</th><th className="r">수량</th><th className="r">도급 단가</th><th className="r">하도급 단가</th><th className="r">하도급 금액</th></tr></thead>
              <tbody>
                {visible.map((r) => {
                  const l = r.line; const g = !!l.children; const on = picked(l.id); const byParent = on && !d.picks.has(l.id);
                  const isOpen = open[l.id] ?? false;
                  return (
                    <tr key={l.id} className={(g ? 'click ' : '') + (on ? 'boq-sub-on' : '')} style={g ? { fontWeight: 600 } : undefined} onClick={g && !find ? () => setOpen({ ...open, [l.id]: !isOpen }) : undefined}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={on} disabled={!editable || byParent} onChange={() => toggle(l.id)} aria-label={l.name + ' 하도급'} style={{ width: 18, height: 18 }} /></td>
                      <td style={{ paddingLeft: 12 + (find ? 0 : r.depth * 16) }}>{g && !find ? (isOpen ? '▾ ' : '▸ ') : ''}{l.name}{!g && l.spec ? <span className="muted"> · {l.spec}</span> : null}</td>
                      <td className="c">{g ? '' : l.unit}</td><td className="r">{g ? '' : fq(l.qty)}</td>
                      <td className="r">{g ? '' : won(l.mu + l.lu + l.eu)}</td>
                      <td className="r">{g || !on || !rateOk ? '' : won(Math.floor(l.mu * rateN + 1e-9) + Math.floor(l.lu * rateN + 1e-9) + Math.floor(l.eu * rateN + 1e-9))}</td>
                      <td className="r">{on && subAmt.has(l.id) ? won(subAmt.get(l.id)) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
              {res && <tfoot><tr><td></td><td>직접공사비 (대상 → 하도급)</td><td></td><td></td><td className="r">{won(res.tDirect.t)}</td><td></td><td className="r">{won(res.sDirect.t)}</td></tr></tfoot>}
            </table></div>
          </section>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {res && <section className="card">
              <h3>원가계산서 대비</h3>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>비목</th><th className="r">하도급 대상</th><th className="r">하도급</th></tr></thead>
                <tbody>{COST_SHOW.map(([k, l]) => <tr key={k} style={['D', 'H', 'J'].includes(k) ? { fontWeight: 700 } : undefined}><td>{l}</td><td className="r">{won(res.target.get(k))}</td><td className="r">{won(res.sub.get(k))}</td></tr>)}</tbody>
              </table></div>
            </section>}
            <section className="card">
              <h3>원가 비목</h3>
              <span className="muted">요율은 ‘{base.title}’ 원가계산서에서 읽었습니다. 보험료 · 퇴직공제 · 보증수수료는 원도급사가 부담하므로 기본으로 뺍니다. 하도급 대상액도 같은 기준으로 계산합니다.</span>
              <div className="boq-chk">
                {inf.found.filter((f) => f.key !== 'vat').map((f) => (
                  <label key={f.key}><input type="checkbox" disabled={!editable} checked={!d.exclude.has(f.key)} onChange={(e) => { const n = new Set(d.exclude); e.target.checked ? n.delete(f.key) : n.add(f.key); set({ exclude: n }); }} />
                    <span>{f.label}</span><em>{+(f.rate * 100).toFixed(4)}%</em></label>))}
              </div>
              <span className="muted">요율 검산: 읽은 요율로 다시 계산한 도급액 {won(inf.calc.total)} {calcSame ? <Pill c="green">엑셀과 같음</Pill> : <Pill c="orange">{won(inf.calc.total - contract)}원 차이</Pill>}</span>
            </section>
          </div>
        </div>
      </>}
      {addModal}
    </>
  );
}

/** 공종 · 항목 행 옮기기 (설계변경 뒤): 같은 종류 · 공종명 · 규격 · 단위 */
function rowMapAll(from: BoqItem[], to: BoqItem[]) {
  const key = (i: BoqItem) => [i.kind === 'group' ? 'g' : 'i', i.name, i.spec, i.unit].map((x) => nospace(x as string)).join('|');
  const ok = (i: BoqItem) => i.section === 'detail' && ['group', 'item', 'link'].includes(i.kind);
  const dest = new Map<string, string | null>();
  for (const i of to.filter(ok)) { const k = key(i); dest.set(k, dest.has(k) ? null : String(i.row)); }
  const out = new Map<string, string>();
  for (const i of from.filter(ok)) { const d = dest.get(key(i)); if (d) out.set(String(i.row), d); }
  return out;
}

function AddModal({ vendors, used, onClose, onAdd }: { vendors: string[]; used: Set<string>; onClose: () => void; onAdd: (vendor: string, rate: number) => void }) {
  const free = vendors.filter((v) => !used.has(v));
  const [v, setV] = useState(free[0] || '');
  const [custom, setCustom] = useState(!free.length);
  const [rate, setRate] = useState('');
  const r = Number(rate) / 100;
  const ok = v.trim() && r > 0 && r <= 1;
  return (
    <Modal title="하도급내역서 만들기" onClose={onClose} foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!ok} onClick={() => onAdd(v.trim(), r)}>만들기</button></>}>
      <div className="field"><label htmlFor="sv">업체</label>
        {!custom ? <select id="sv" className="input" value={v} onChange={(e) => { if (e.target.value === '__') { setCustom(true); setV(''); } else setV(e.target.value); }}>
          {free.map((x) => <option key={x} value={x}>{x}</option>)}<option value="__">직접 입력…</option></select>
          : <input id="sv" className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder="업체 이름" autoFocus />}
        <span className="muted">프로젝트 정보의 하도급사 이름과 같게 쓰면 하도급액을 프로젝트 정보에 반영할 수 있습니다.</span></div>
      <div className="field"><label htmlFor="sr">하도급율 (%)</label>
        <input id="sr" className="input" inputMode="decimal" style={{ maxWidth: 160 }} placeholder="예: 82" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} /></div>
    </Modal>
  );
}
