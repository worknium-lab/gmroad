// ④ 내역서 — 안쪽 탭: 한눈에(흐름 · 남은 일 · 가져오기 · 이력) / 내역서(공종별 내역) / 원가계산서
//   엑셀 원본이 기준이고, 적산 엔진(lib/estimate)은 같은 규칙으로 다시 계산해 검산합니다.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, q, sb } from '../../lib/supabase';
import { verify, summaryAmt, shortRef } from '../../lib/boqSheet';
import { download } from '../../lib/files';
import { dt, qty, won } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Empty, Pill, Modal } from '../../lib/ui';
import { useAuth } from '../../lib/auth';
import { ChangeView, ChangeCreate, PasswordModal, UnlockModal, BoqLogs, fetchItems } from './BoqChange';

const KIND: Record<string, [string, string]> = { design: ['설계', 'blue'], contract: ['도급', 'green'], change: ['변경', 'orange'], final: ['준공', ''] };
const TOT: [string, string][] = [['direct', '직접공사비'], ['net', '순공사비'], ['overhead', '일반관리비'], ['profit', '이윤'], ['supply', '공급가액'], ['vat', '부가세'], ['contract', '도급(예정)액'], ['govMaterial', '관급자재'], ['grand', '총공사비']];
const FIXED_DEFAULT = /(건강보험|연금보험|노인장기요양|산업안전보건관리비|퇴직공제)/;
const NORATE_DEFAULT = /관급/;
const nospace = (s: string) => (s || '').replace(/\s+/g, '');
const pctS = (v: number, d = 3) => (v * 100).toFixed(d) + '%';

type Rev = any; type Item = any;
type View = 'flow' | 'boq' | 'cost';
const VIEWS: [View, string][] = [['flow', '한눈에'], ['boq', '내역서'], ['cost', '원가계산서']];

export default function Boq({ pid, p }: { pid: string; p: any }) {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const asked = VIEWS.find(([k]) => k === sp.get('v'))?.[0];
  const go = (v: View, id?: string) => { if (id) setSel(id); const n = new URLSearchParams(sp); n.set('v', v); setSp(n, { replace: true }); };
  const revs = useLoad(() => q<Rev[]>(sb.from('boq_revisions').select('*, profiles:created_by(name, username)').eq('project_id', pid).order('created_at')), [pid]);
  const docs = useLoad(() => q<any[]>(sb.from('documents').select('*').eq('project_id', pid).in('category', ['design_boq', 'contract']).order('created_at', { ascending: false })), [pid]);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [wizard, setWizard] = useState(false);
  const [mkChange, setMkChange] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [stamp, setStamp] = useState(0);
  const { isAdmin, profile } = useAuth();

  if (revs.loading || docs.loading) return <Loading />;
  if (revs.error) return <ErrorBox msg={revs.error.includes('boq_revisions') ? '내역서 표가 아직 없습니다. 서버에서 bash scripts/update.sh 를 실행해 주세요.' : revs.error} />;
  const list = revs.data || [];
  const cur = list.find((r) => r.id === sel) || list[list.length - 1];
  // 처음 열 때: 내역서가 있으면 내역서, 없으면 한눈에(가져오기)
  const view: View = asked || (list.length ? 'boq' : 'flow');
  const boqDocs = (docs.data || []).filter((d) => d.category === 'design_boq');
  const contractAmt = (docs.data || []).find((d) => d.category === 'contract' && d.subcategory === '도급계약서' && d.contract_amount)?.contract_amount || p.prime_amount;
  const design = list.filter((r) => r.kind === 'design');
  const contracts = list.filter((r) => r.kind === 'contract');
  const finals = list.filter((r) => r.kind === 'final');
  const changeDraft = list.some((r) => r.kind === 'change' && r.status !== 'confirmed');
  const lastFinal = [...finals].sort((a, b) => b.seq - a.seq)[0];
  const changeBases = lastFinal ? [lastFinal] : contracts;
  const rate = [...contracts].reverse().find((c) => c.params?.rate)?.params?.rate;
  const refresh = async (id?: string) => { await revs.reload(); if (id) setSel(id); setStamp((x) => x + 1); };

  const doImport = async (d: any) => {
    setBusy(d.id);
    try {
      const r = await api('/api/boq/import', { project_id: pid, document_id: d.id });
      toast(r.check.diffCount ? `가져왔습니다 · 엑셀과 다른 값 ${r.check.diffCount}곳 확인 필요` : `가져왔습니다 · ${r.items}줄, 금액 ${r.check.checked}칸 엑셀과 일치`);
      await revs.reload(); setSel(r.revision_id);
    } catch (e: any) { toast(e.message); }
    setBusy('');
  };
  const doDelete = async (r: Rev) => {
    if (!confirm(`'${r.title}'을(를) 지울까요?`)) return;
    try { await api('/api/boq/delete', { revision_id: r.id }); setSel(null); revs.reload(); toast('지웠습니다'); } catch (e: any) { toast(e.message); }
  };

  return (
    <>
      <section className="card">
        <div className="card-h"><h2>내역서 차수</h2>
          <div className="row">
            {design.length > 0 && <button className={'btn' + (contracts.length ? '' : ' pri')} onClick={() => setWizard(true)}>도급내역서 만들기</button>}
            {contracts.length > 0 && <button className="btn pri" disabled={changeDraft} title={changeDraft ? '작성 중인 변경내역서를 먼저 확정하세요' : undefined} onClick={() => setMkChange(true)}>변경내역서 만들기</button>}
            {isAdmin && <button className="btn sm" onClick={() => setPwOpen(true)}>잠금 비밀번호</button>}
          </div>
        </div>
        {list.length === 0 && <Empty>아직 내역서가 없습니다. 아래에서 설계내역서 엑셀을 가져오세요.</Empty>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {list.map((r) => (
            <button key={r.id} className={'btn' + (cur?.id === r.id ? ' pri' : '')} onClick={() => setSel(r.id)} aria-pressed={cur?.id === r.id}>
              <Pill c={KIND[r.kind][1]}>{KIND[r.kind][0]}</Pill> {r.title}{r.kind === 'contract' && r.params?.rate ? ` · ${pctS(r.params.rate)}` : ''}{r.kind !== 'design' && (r.locked ? ' 🔒' : r.kind === 'change' ? ' · 작성 중' : '')}
            </button>
          ))}
        </div>
      </section>

      <div className="subtabs boq" role="tablist" aria-label="내역서 안 탭">
        {VIEWS.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}
      </div>

      {view === 'flow' && <>
        <BoqFlow list={list} cur={cur} onPick={(id) => go('boq', id)}
          onWizard={() => setWizard(true)} onChange={() => setMkChange(true)} changeDraft={changeDraft} />
        <section className="card">
          <div className="card-h"><h2>설계내역서 가져오기</h2><span className="muted">② 설계 · 계약서류 › 설계내역서에 올린 엑셀</span></div>
          {boqDocs.length === 0 && <span className="sub">② 설계 · 계약서류 탭의 '설계내역서'에 엑셀(xlsx)을 먼저 올려 주세요.</span>}
          {boqDocs.map((d) => {
            const done = list.find((r) => r.source_document_id === d.id);
            return (
              <div key={d.id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line-2)', paddingTop: 10 }}>
                <div><b>{d.title}</b> <span className="muted">v{d.version} · {dt(d.created_at)}</span></div>
                {done ? <Pill c="green">가져옴</Pill>
                  : <button className="btn" disabled={!!busy} onClick={() => doImport(d)}>{busy === d.id ? '계산 맞춰보는 중…' : '가져오기'}</button>}
              </div>
            );
          })}
        </section>
        {list.length > 0 && <BoqLogs pid={pid} revId={undefined} stamp={stamp + (revs.data?.length || 0)} />}
      </>}

      {view !== 'flow' && !cur && <Empty>아직 내역서가 없습니다. <button className="link" onClick={() => go('flow')}>한눈에</button> 탭에서 설계내역서 엑셀을 가져오세요.</Empty>}
      {view === 'boq' && cur && cur.kind === 'change' && <ChangeView key={cur.id} rev={cur} rate={rate} onChanged={refresh} onDelete={() => doDelete(cur)} />}
      {view === 'boq' && cur && cur.kind !== 'change' && <RevView key={cur.id} rev={cur} base={list.find((r) => r.id === cur.base_id && r.kind !== 'change')} onDelete={() => doDelete(cur)} onChanged={refresh} />}
      {view === 'cost' && cur && <CostView key={cur.id} rev={cur} base={list.find((r) => r.id === cur.base_id)} />}
      {view === 'boq' && cur && <BoqLogs pid={pid} revId={cur.id} stamp={stamp + (revs.data?.length || 0)} />}
      {mkChange && <ChangeCreate p={p} bases={changeBases} onClose={() => setMkChange(false)} onDone={(id) => { setMkChange(false); refresh(id); toast('변경내역서를 만들었습니다'); }} />}
      {pwOpen && <PasswordModal defaultCompany={p.company_id || profile?.company_id} onClose={() => setPwOpen(false)} />}

      {wizard && <ContractWizard designs={design} defaultTarget={contractAmt} onClose={() => setWizard(false)}
        onDone={async (id) => { setWizard(false); await refresh(id); toast('도급내역서를 만들었습니다'); }} />}
    </>
  );
}

/* ---------- 한 차수 보기 ---------- */
function RevView({ rev, base, onDelete, onChanged }: { rev: Rev; base?: Rev; onDelete: () => void; onChanged: (id?: string) => void }) {
  const toast = useToast();
  const [unlock, setUnlock] = useState(false);
  const confirmIt = async () => {
    if (!window.confirm(`'${rev.title}'을(를) 확정하고 잠글까요? 잠금 해제는 비밀번호가 필요합니다.`)) return;
    try { await api('/api/boq/confirm', { revision_id: rev.id }); toast('확정했습니다'); onChanged(rev.id); } catch (e: any) { toast(e.message); }
  };
  const items = useLoad(() => fetchItems(rev.id), [rev.id]);
  const baseItems = useLoad(() => (base ? fetchItems(base.id) : Promise.resolve([])), [base?.id]);
  const section = 'detail';
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const calc = useMemo(() => (items.data ? verify(items.data) : null), [items.data]);
  const [showDiff, setShowDiff] = useState(false);
  const [find, setFind] = useState('');
  const t = rev.totals || {};
  const bt = base?.totals || {};
  const baseMap = useMemo(() => new Map((baseItems.data || []).map((i: Item) => [i.row, i])), [baseItems.data]);

  const rows = useMemo(() => {
    const all = (items.data || []).filter((i: Item) => i.section === section);
    if (find.trim()) { const f = nospace(find); return all.filter((i: Item) => nospace(i.name).includes(f) || nospace(i.spec || '').includes(f)); }
    const byRow = new Map(all.map((i: Item) => [i.row, i]));
    // 위 그룹이 모두 펼쳐져 있어야 보임 (요약표는 모두 보임)
    return all.filter((i: Item) => {
      let pr = i.parent_row;
      while (pr != null) { if (!(open[pr] ?? false)) return false; pr = byRow.get(pr)?.parent_row ?? null; }
      return true;
    });
  }, [items.data, section, open, find]);

  const chk = rev.check_result;
  const res = rev.params?.result;
  return (
    <section className="card">
      <div className="card-h">
        <h2><Pill c={KIND[rev.kind][1]}>{KIND[rev.kind][0]}</Pill> {rev.title} {rev.kind !== 'design' && rev.locked && <Pill c="blue">🔒 확정</Pill>}</h2>
        <div className="row">
          <button className="btn" onClick={() => download(rev.storage_path, rev.file_name)}>엑셀 내려받기</button>
          {rev.kind === 'contract' && !rev.locked && <button className="btn pri" onClick={confirmIt}>확정</button>}
          {rev.kind === 'contract' && rev.locked && <button className="btn" onClick={() => setUnlock(true)}>잠금 해제</button>}
          {!rev.locked && <button className="btn sm" onClick={onDelete}>지우기</button>}
        </div>
      </div>
      <div className="muted">{rev.file_name} · 시트 '{rev.sheet_name}' · {dt(rev.created_at)} · {rev.profiles?.name || rev.profiles?.username || ''}{rev.kind === 'final' && rev.params?.from ? ` · ${rev.params.from} 확정값` : ''}</div>
      {unlock && <UnlockModal rev={rev} onClose={() => setUnlock(false)} onDone={() => { setUnlock(false); toast('잠금을 풀었습니다'); onChanged(rev.id); }} />}
      {chk && (chk.diffCount ? <div className="banner">엑셀에 저장된 값과 프로그램 계산이 {chk.diffCount}곳 다릅니다 (예: {chk.diffs.slice(0, 3).map((d: any) => `${d.cell} 엑셀 ${won(d.excel)} / 계산 ${won(d.calc)}`).join(', ')}). 엑셀에서 다시 저장한 뒤 올려 보세요.</div>
        : <div className="banner teal">금액 {chk.checked.toLocaleString()}칸을 다시 계산해 엑셀과 모두 일치합니다.</div>)}
      {res && <div className="banner blue">낙찰률 {pctS(res.rate)} 적용 · 단가 {res.changedCells}칸 변경 · 고정 {res.fixedCells}칸 · 이윤 조정 {won(res.profitAdjust)}원 · 이윤율 {res.profitRate}%</div>}
      {calc && (calc.diffs.length === 0
        ? <div className="banner teal">적산 규칙(비목별 수량 × 단가, 원 미만 버림)으로 {calc.checked.toLocaleString()}줄을 다시 계산했습니다. 모두 같습니다.</div>
        : <div className="banner">
            <span style={{ flex: 1 }}>적산 규칙(비목별 수량 × 단가, 원 미만 버림)으로 다시 계산하면 <b>{calc.diffs.filter((d) => d.kind !== 'group').length}개 항목</b>{calc.diffs.some((d) => d.kind === 'group') ? '과 그 위 소계' : ''}가 엑셀 금액과 다릅니다. 엑셀에서 단가를 반올림했거나 금액을 손으로 넣은 줄일 수 있습니다.</span>
            <button className="btn sm" onClick={() => setShowDiff(!showDiff)}>{showDiff ? '닫기' : '어디인지 보기'}</button>
          </div>)}
      {calc && showDiff && calc.diffs.length > 0 && (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>행</th><th>공종명</th><th className="r">엑셀 금액</th><th className="r">다시 계산</th><th className="r">차이</th></tr></thead>
          <tbody>{calc.diffs.slice(0, 30).map((d) => (
            <tr key={d.row} className="click" onClick={() => setFind(d.name)}>
              <td className="muted num">{d.row}</td><td>{d.kind === 'group' ? <span className="muted">(소계) </span> : null}{d.name}</td>
              <td className="r">{won(d.excel)}</td><td className="r">{won(d.calc)}</td><td className="r">{(d.calc - d.excel > 0 ? '+' : '') + won(d.calc - d.excel)}</td>
            </tr>))}</tbody>
        </table>{calc.diffs.length > 30 && <div className="muted" style={{ padding: 8 }}>앞 30줄만 보입니다 (모두 {calc.diffs.length}줄)</div>}</div>)}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {TOT.filter(([k]) => t[k]).map(([k, l]) => (
          <div key={k} className="card" style={{ padding: 12, gap: 2, background: k === 'contract' ? 'var(--blue-l)' : undefined }}>
            <span className="muted">{l}</span><b className="num">{won(t[k])}</b>
            {base && bt[k] ? <span className="muted num">설계 {won(bt[k])} ({t[k] - bt[k] >= 0 ? '+' : ''}{won(t[k] - bt[k])})</span> : null}
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h3>공종별 내역</h3>
        <div className="row">
          {!find && <>
            <button className="btn sm" onClick={() => setOpen(Object.fromEntries((items.data || []).filter((i: Item) => i.kind === 'group').map((i: Item) => [i.row, true])))}>모두 펼치기</button>
            <button className="btn sm" onClick={() => setOpen({})}>접기</button></>}
          <input className="input" style={{ width: 180 }} placeholder="공종 찾기" value={find} onChange={(e) => setFind(e.target.value)} aria-label="공종 찾기" />
        </div>
      </div>

      {items.loading ? <Loading /> : items.error ? <ErrorBox msg={items.error} /> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>행</th><th>공종명</th><th>규격</th><th className="c">단위</th><th className="r">수량</th><th className="r">재료비 단가</th><th className="r">노무비 단가</th><th className="r">경비 단가</th><th className="r">합계 단가</th><th className="r">합계 금액</th>{base && <th className="r">설계 대비</th>}<th>단가 근거</th></tr></thead>
            <tbody>
              {rows.map((i: Item) => {
                const isG = i.kind === 'group';
                const b = baseMap.get(i.row);
                const diff = b ? Number(i.total_amt) - Number(b.total_amt) : 0;
                return (
                  <tr key={i.row} className={isG ? 'click' : ''} onClick={isG && !find ? () => setOpen({ ...open, [i.row]: !open[i.row] }) : undefined}
                    style={i.kind === 'cost' || isG ? { background: isG && i.level === 0 ? 'var(--head)' : undefined, fontWeight: isG || (i.kind === 'cost' && /(계|액)$/.test(nospace(i.name))) ? 600 : undefined } : undefined}>
                    <td className="muted num">{i.row}</td>
                    <td style={{ paddingLeft: 12 + (section === 'detail' ? i.level * 16 : 0) }}>{isG && !find ? (open[i.row] ? '▾ ' : '▸ ') : ''}{i.name}</td>
                    <td className="sub">{i.spec}</td>
                    <td className="c">{i.unit}</td>
                    <td className="r">{i.kind === 'item' ? qty(i.qty) : ''}</td>
                    <td className="r">{i.kind === 'item' ? won(i.mat_price) : ''}</td>
                    <td className="r">{i.kind === 'item' ? won(i.lab_price) : ''}</td>
                    <td className="r">{i.kind === 'item' ? won(i.exp_price) : ''}</td>
                    <td className="r">{i.kind === 'item' || i.kind === 'link' ? won(Number(i.mat_price || 0) + Number(i.lab_price || 0) + Number(i.exp_price || 0)) : ''}</td>
                    <td className="r">{won(i.total_amt)}</td>
                    {base && <td className="r num" style={{ color: diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--teal)' : 'var(--sub)' }}>{b && diff ? (diff > 0 ? '+' : '') + won(diff) : ''}</td>}
                    <td className="muted" title={i.price_ref || undefined}>{shortRef(i.price_ref)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={base ? 12 : 11} className="sub">찾는 공종이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}


/* ---------- 도급내역서 만들기 (3단계) ---------- */
function ContractWizard({ designs, defaultTarget, onClose, onDone }: { designs: Rev[]; defaultTarget: any; onClose: () => void; onDone: (id: string) => void }) {
  const [baseId, setBaseId] = useState(designs[designs.length - 1].id);
  const items = useLoad(() => fetchItems(baseId), [baseId]);
  const [step, setStep] = useState(1);
  const [fixed, setFixed] = useState<Set<number> | null>(null);
  const [noRate, setNoRate] = useState<Set<number> | null>(null);
  const [rate, setRate] = useState('');
  const [target, setTarget] = useState(defaultTarget ? String(Math.trunc(Number(defaultTarget))) : '');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const costRows = (items.data || []).filter((i: Item) => i.kind === 'cost' && i.section === 'summary' && /^\d+\)/.test(i.name.trim()));
  const groups = (items.data || []).filter((i: Item) => i.kind === 'group' && i.section === 'detail' && i.level === 0);
  const fx = fixed ?? new Set(costRows.filter((i: Item) => FIXED_DEFAULT.test(nospace(i.name))).map((i: Item) => i.row));
  const nr = noRate ?? new Set(groups.filter((i: Item) => NORATE_DEFAULT.test(nospace(i.name))).map((i: Item) => i.row));
  const toggle = (s: Set<number>, set: (v: Set<number>) => void, r: number) => { const n = new Set(s); n.has(r) ? n.delete(r) : n.add(r); set(n); setPreview(null); };
  const rateN = Number(rate) / 100;
  const targetN = Math.trunc(Number(target.replace(/\D/g, '')));
  const designT = designs.find((d) => d.id === baseId)?.totals || {};

  const body = (dry: boolean) => ({ revision_id: baseId, rate: rateN, target: targetN || null, fixed_rows: [...fx], no_rate_rows: [...nr], dry_run: dry });
  const run = async (dry: boolean) => {
    setErr(''); setBusy(true);
    try {
      const r = await api('/api/boq/contract', body(dry));
      if (dry) setPreview(r); else onDone(r.revision_id);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const ok2 = rateN > 0.5 && rateN <= 1;
  const res = preview?.result;
  const warn: string[] = [];
  if (res) {
    if (targetN && res.residual) warn.push(`도급액이 목표와 ${won(res.residual)}원 차이 납니다. 이윤만으로 맞출 수 없습니다.`);
    if (res.profitRate > 15) warn.push(`이윤율이 ${res.profitRate}%로 15%를 넘습니다. 계약금액이나 낙찰률을 다시 확인하세요.`);
    if (res.profit < 0) warn.push('이윤이 0보다 작아집니다.');
  }

  const foot = <>
    {step > 1 && <button className="btn" onClick={() => { setStep(step - 1); setPreview(null); }}>이전</button>}
    {step < 3 && <button className="btn pri" disabled={step === 2 && !ok2} onClick={() => setStep(step + 1)}>다음</button>}
    {step === 3 && <button className="btn" disabled={busy || !ok2} onClick={() => run(true)}>{busy && !preview ? '계산 중…' : '미리 계산'}</button>}
    {step === 3 && <button className="btn pri" disabled={busy || !preview} onClick={() => run(false)}>{busy && preview ? '만드는 중…' : '도급내역서 만들기'}</button>}
  </>;

  return (
    <Modal title={`도급내역서 만들기 · ${step}/3`} onClose={onClose} foot={foot} wide>
      {designs.length > 1 && <div className="field"><label htmlFor="bz">기준 설계내역서</label>
        <select id="bz" className="input" value={baseId} onChange={(e) => { setBaseId(e.target.value); setFixed(null); setNoRate(null); setPreview(null); }}>
          {designs.map((d) => <option key={d.id} value={d.id}>{d.title} · {d.file_name}</option>)}</select></div>}
      {items.loading ? <Loading /> : items.error ? <ErrorBox msg={items.error} /> : <>
        {step === 1 && <>
          <p className="sub">원가계산서에서 <b>금액을 그대로 두는 항목</b>을 고르세요. 체크한 항목은 설계 금액이 숫자로 고정되고, 나머지는 수식대로 다시 계산됩니다.</p>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>고정</th><th>항목</th><th className="r">설계 금액</th></tr></thead><tbody>
            {costRows.map((i: Item) => (
              <tr key={i.row} className="click" onClick={() => toggle(fx, setFixed, i.row)}>
                <td><input type="checkbox" checked={fx.has(i.row)} readOnly aria-label={i.name + ' 고정'} style={{ width: 22, height: 22 }} /></td>
                <td>{i.name}</td><td className="r">{won(i.total_amt)}</td></tr>))}
          </tbody></table></div>
        </>}
        {step === 2 && <>
          <div className="field"><label htmlFor="rt">낙찰률 (%)</label>
            <input id="rt" className="input" inputMode="decimal" placeholder="예: 88.496" value={rate} onChange={(e) => { setRate(e.target.value.replace(/[^\d.]/g, '')); setPreview(null); }} style={{ maxWidth: 200 }} />
            {rate && !ok2 && <span className="muted" style={{ color: 'var(--red)' }}>50 ~ 100 사이 숫자를 넣어 주세요</span>}</div>
          <p className="sub">재료비 · 노무비 · 경비 단가에 낙찰률을 곱하고 원 미만은 버립니다 (TRUNC). <b>낙찰률을 적용하지 않을 묶음</b>에 체크하세요 (관급자재는 기본으로 체크).</p>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>제외</th><th>공종 묶음</th><th className="r">설계 금액</th></tr></thead><tbody>
            {groups.map((i: Item) => (
              <tr key={i.row} className="click" onClick={() => toggle(nr, setNoRate, i.row)}>
                <td><input type="checkbox" checked={nr.has(i.row)} readOnly aria-label={i.name + ' 제외'} style={{ width: 22, height: 22 }} /></td>
                <td>{i.name}</td><td className="r">{won(i.total_amt)}</td></tr>))}
          </tbody></table></div>
        </>}
        {step === 3 && <>
          <div className="field"><label htmlFor="tg">도급(계약) 금액 — 부가세 포함</label>
            <input id="tg" className="input num" inputMode="numeric" value={targetN ? targetN.toLocaleString('ko-KR') : ''} onChange={(e) => { setTarget(e.target.value); setPreview(null); }} style={{ maxWidth: 260 }} />
            <span className="muted">도급계약서 금액을 먼저 채웠습니다. 비우면 낙찰률만 적용합니다. 차이는 이윤에서 맞춥니다.</span></div>
          <div className="muted">설계 도급예정액 {won(designT.contract)}원 · 낙찰률 {rate || '-'}% · 고정 {fx.size}개 · 제외 묶음 {nr.size}개</div>
          {res && <div className="tbl-wrap"><table className="tbl"><tbody>
            <tr><td>설계 도급예정액</td><td className="r">{won(res.designContract)}</td></tr>
            <tr><td>낙찰률만 적용했을 때</td><td className="r">{won(res.afterRate)}</td></tr>
            {targetN ? <tr><td>목표 금액</td><td className="r">{won(res.target)}</td></tr> : null}
            <tr><td><b>만들어질 도급액</b></td><td className="r"><b>{won(res.reached ?? res.afterRate)}</b></td></tr>
            <tr><td>이윤 (설계 {won(res.designProfit)})</td><td className="r">{won(res.profit)} · {res.profitRate}%</td></tr>
            <tr><td>바뀌는 단가 칸</td><td className="r">{res.changedCells.toLocaleString()}칸</td></tr>
          </tbody></table></div>}
          {warn.map((w) => <div key={w} className="banner">{w}</div>)}
          {res && !warn.length && <div className="banner teal">목표 금액에 정확히 맞습니다. 만들면 원본 엑셀의 수식 · 서식을 그대로 두고 단가만 바꾼 파일이 생깁니다.</div>}
          {err && <div className="banner red">{err}</div>}
        </>}
      </>}
    </Modal>
  );
}

/* ---------- 한눈에: 내역서 흐름 · 남은 일 ---------- */
function BoqFlow({ list, cur, onPick, onWizard, onChange, changeDraft }: { list: Rev[]; cur?: Rev; onPick: (id: string) => void; onWizard: () => void; onChange: () => void; changeDraft: boolean }) {
  const cols: [string, string, Rev[]][] = [
    ['design', '설계', list.filter((r) => r.kind === 'design')],
    ['contract', '도급', list.filter((r) => r.kind === 'contract')],
    ['change', '변경', list.filter((r) => r.kind === 'change').sort((a, b) => a.seq - b.seq)],
    ['final', '준공', list.filter((r) => r.kind === 'final').sort((a, b) => a.seq - b.seq)],
  ];
  const state = (r: Rev): [string, string] => r.kind === 'design' ? ['가져옴', 'blue'] : r.locked || r.status === 'confirmed' ? ['🔒 확정', 'green'] : ['작성 중', 'orange'];
  const todo: { t: string; s?: string; act?: [string, () => void] }[] = [];
  const [d, c, ch] = [cols[0][2], cols[1][2], cols[2][2]];
  if (!d.length) todo.push({ t: '설계내역서 엑셀 가져오기', s: '아래 ‘설계내역서 가져오기’에서 엑셀을 고르세요' });
  if (d.length && !c.length) todo.push({ t: '도급내역서 만들기', s: '낙찰률과 계약서 금액으로 만듭니다', act: ['도급내역서 만들기', onWizard] });
  for (const r of c.filter((x) => !x.locked)) todo.push({ t: `‘${r.title}’ 확정`, s: '확정해야 변경내역서의 당초가 됩니다', act: ['열기', () => onPick(r.id)] });
  for (const r of ch.filter((x) => !x.locked && x.status !== 'confirmed')) todo.push({ t: `‘${r.title}’ 확정`, s: '확정하면 준공내역서가 만들어집니다', act: ['열기', () => onPick(r.id)] });
  for (const r of list.filter((x) => x.check_result?.diffCount)) todo.push({ t: `‘${r.title}’ 엑셀 값 ${r.check_result.diffCount}곳 확인`, s: '엑셀에 저장된 값과 다시 계산한 값이 다릅니다', act: ['열기', () => onPick(r.id)] });
  if (c.some((x) => x.locked) && !changeDraft && !ch.length) todo.push({ t: '설계변경이 생기면 변경내역서 만들기', s: '아직 변경이 없으면 할 일 없음', act: ['변경내역서 만들기', onChange] });

  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <section className="card">
        <div className="card-h"><h2>내역서 흐름</h2><span className="muted">상자를 누르면 그 내역서를 엽니다</span></div>
        <span className="muted">설계 → 도급 → 변경(1차 · 2차 …) → 준공 순서입니다. 변경내역서를 확정하면 준공내역서가 만들어지고, 다음 차수 변경은 그 준공내역서를 당초로 합니다.</span>
        <div className="boq-flow">
          {cols.map(([k, l, rs], ci) => (
            <div key={k} className="boq-col">
              <div className="muted boq-col-h">{ci > 0 && <span aria-hidden="true">→ </span>}{l}</div>
              {rs.length === 0 && <div className="boq-box wait"><span className="muted">아직 없음</span></div>}
              {rs.map((r) => {
                const [st, sc] = state(r);
                return (
                  <button key={r.id} type="button" className={'boq-box' + (cur?.id === r.id ? ' cur' : '') + (st === '작성 중' ? ' work' : '')} onClick={() => onPick(r.id)}>
                    <span className="row between"><Pill c={KIND[r.kind][1]}>{KIND[r.kind][0]}</Pill><Pill c={sc}>{st}</Pill></span>
                    <b>{r.title}</b>
                    <span className="num amt">{won(r.totals?.contract)}</span>
                    <span className="muted">{r.kind === 'contract' && r.params?.rate ? `낙찰률 ${pctS(r.params.rate)} · ` : ''}{dt(r.confirmed_at || r.created_at)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>지금 남은 일</h2>
        {todo.length === 0 && <span className="sub">남은 일이 없습니다.</span>}
        {todo.map((x, i) => (
          <div key={i} className="row between" style={{ borderTop: i ? '1px solid var(--line-2)' : undefined, paddingTop: i ? 10 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><b>{x.t}</b>{x.s && <span className="muted">{x.s}</span>}</div>
            {x.act && <button className="btn sm" onClick={x.act[1]}>{x.act[0]}</button>}
          </div>
        ))}
      </section>
    </div>
  );
}

/* ---------- 원가계산서 ---------- */
function CostView({ rev, base }: { rev: Rev; base?: Rev }) {
  const items = useLoad(() => fetchItems(rev.id), [rev.id]);
  const baseItems = useLoad(() => (base ? fetchItems(base.id) : Promise.resolve([])), [base?.id]);
  const calc = useMemo(() => (items.data ? verify(items.data) : null), [items.data]);
  const baseMap = useMemo(() => new Map((baseItems.data || []).filter((i: Item) => i.section === 'summary').map((i: Item) => [nospace(i.name), i])), [baseItems.data]);
  if (items.loading) return <Loading />;
  if (items.error) return <ErrorBox msg={items.error} />;
  const all = items.data || [];
  const rows = all.filter((i: Item) => i.section === 'summary');
  const t = rev.totals || {};
  const contract = Number(t.contract || 0);
  const res = rev.params?.result;
  const d = calc?.direct;
  const checks: [string, number | null, number][] = d ? [
    ['직접재료비', summaryAmt(all, /직접재료비/), d.m],
    ['직접노무비', summaryAmt(all, /직접노무비/), d.l],
    ['직접경비 (산출경비)', summaryAmt(all, /(산출|직접)경비/), d.e],
    ['직접공사비', t.direct != null ? Number(t.direct) : null, d.t],
  ] : [];
  const seg: [string, number, string][] = d && t.net ? [
    ['재료비', d.m, 'var(--blue)'], ['노무비', d.l, '#3F6FAE'], ['경비', d.e, '#7D9CC9'],
    ['간접비 · 보험료', Number(t.net) - d.t, '#A9BCD9'], ['일반관리비', Number(t.overhead || 0), 'var(--teal)'],
    ['이윤', Number(t.profit || 0), 'var(--orange-d)'], ['부가세', Number(t.vat || 0), 'var(--muted)'],
  ].filter((x) => (x[1] as number) > 0) as [string, number, string][] : [];
  const segSum = seg.reduce((s, x) => s + x[1], 0);
  const bold = (i: Item) => i.kind === 'cost' && /(계|액)$/.test(nospace(i.name));

  return (
    <div className="grid boq-cost">
      <section className="card flat">
        <div className="card-h" style={{ padding: '14px 16px' }}>
          <h2><Pill c={KIND[rev.kind][1]}>{KIND[rev.kind][0]}</Pill> 원가계산서 · {rev.title}</h2>
          <button className="btn sm" onClick={() => download(rev.storage_path, rev.file_name)}>엑셀 내려받기</button>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>비목</th><th className="r">금액</th><th className="r">도급액 대비</th>{base && <th className="r">{KIND[base.kind][0]} 대비</th>}</tr></thead>
            <tbody>
              {rows.map((i: Item) => {
                const b = baseMap.get(nospace(i.name));
                const diff = b ? Number(i.total_amt) - Number(b.total_amt) : 0;
                return (
                  <tr key={i.row} style={bold(i) ? { fontWeight: 700, background: 'var(--head)' } : undefined}>
                    <td style={{ paddingLeft: 12 + Math.min(i.indent || 0, 2) * 12 }}>{i.name}</td>
                    <td className="r">{won(i.total_amt)}</td>
                    <td className="r muted">{contract && Number(i.total_amt) ? ((Number(i.total_amt) / contract) * 100).toFixed(2) + '%' : ''}</td>
                    {base && <td className="r num" style={{ color: diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--teal)' : 'var(--sub)' }}>{b && diff ? (diff > 0 ? '+' : '') + won(diff) : ''}</td>}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={base ? 4 : 3} className="sub">이 엑셀에서 원가계산서 부분을 찾지 못했습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {seg.length > 0 && (
          <section className="card">
            <h3>금액 구성</h3>
            <div className="boq-bb" role="img" aria-label={seg.map((x) => `${x[0]} ${((x[1] / segSum) * 100).toFixed(1)}%`).join(', ')}>
              {seg.map(([l, v, c]) => <span key={l} style={{ flex: v, background: c }} title={`${l} ${won(v)}`}>{v / segSum > 0.08 ? l : ''}</span>)}
            </div>
            <div className="boq-lg">
              {seg.map(([l, v, c]) => <span key={l}><i style={{ background: c }} />{l} <b className="num">{((v / segSum) * 100).toFixed(1)}%</b></span>)}
            </div>
          </section>
        )}
        {res && (
          <section className="card">
            <h3>낙찰률 · 계약금액 맞추기</h3>
            <div className="boq-kv">
              <span>설계 도급예정액</span><b className="num">{won(res.designContract)}</b>
              <span>낙찰률 {pctS(res.rate)}만 적용</span><b className="num">{won(res.afterRate)}</b>
              {res.target ? <><span>계약서 금액</span><b className="num">{won(res.target)}</b></> : null}
              <span>이윤에서 조정</span><b className="num" style={{ color: res.profitAdjust < 0 ? 'var(--red)' : undefined }}>{won(res.profitAdjust)}</b>
              <span>이윤율</span><b className="num">{res.profitRate}%</b>
            </div>
          </section>
        )}
        {checks.length > 0 && (
          <section className="card">
            <h3>검산</h3>
            <span className="muted">공종별 내역을 적산 규칙으로 다시 더해 원가계산서 첫 줄들과 맞춰 봅니다.</span>
            <table className="tbl">
              <thead><tr><th>비목</th><th className="r">원가계산서</th><th className="r">다시 계산</th><th></th></tr></thead>
              <tbody>{checks.map(([l, x, c]) => {
                const ok = x !== null && Math.abs(x - c) < 1;
                return <tr key={l}><td>{l}</td><td className="r">{x === null ? '—' : won(x)}</td><td className="r">{won(c)}</td>
                  <td>{x === null ? <span className="muted">줄 없음</span> : ok ? <Pill c="green">같음</Pill> : <Pill c="orange">{(c - x > 0 ? '+' : '') + won(c - x)}</Pill>}</td></tr>;
              })}</tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
