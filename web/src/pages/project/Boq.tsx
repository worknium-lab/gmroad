// ④ 내역서 — 설계내역서 가져오기 · 도급내역서 만들기 · 차수별 보기 · 엑셀 내려받기
import { useMemo, useState } from 'react';
import { api, q, sb } from '../../lib/supabase';
import { download } from '../../lib/files';
import { dt, qty, won } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Empty, Pill, Modal } from '../../lib/ui';

const KIND: Record<string, [string, string]> = { design: ['설계', 'blue'], contract: ['도급', 'green'], change: ['변경', 'orange'], final: ['준공', ''] };
const TOT: [string, string][] = [['direct', '직접공사비'], ['net', '순공사비'], ['overhead', '일반관리비'], ['profit', '이윤'], ['supply', '공급가액'], ['vat', '부가세'], ['contract', '도급(예정)액'], ['govMaterial', '관급자재'], ['grand', '총공사비']];
const FIXED_DEFAULT = /(건강보험|연금보험|노인장기요양|산업안전보건관리비|퇴직공제)/;
const NORATE_DEFAULT = /관급/;
const nospace = (s: string) => (s || '').replace(/\s+/g, '');
const pctS = (v: number, d = 3) => (v * 100).toFixed(d) + '%';

type Rev = any; type Item = any;

export default function Boq({ pid, p }: { pid: string; p: any }) {
  const toast = useToast();
  const revs = useLoad(() => q<Rev[]>(sb.from('boq_revisions').select('*, profiles:created_by(name, username)').eq('project_id', pid).order('created_at')), [pid]);
  const docs = useLoad(() => q<any[]>(sb.from('documents').select('*').eq('project_id', pid).in('category', ['design_boq', 'contract']).order('created_at', { ascending: false })), [pid]);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [wizard, setWizard] = useState(false);

  if (revs.loading || docs.loading) return <Loading />;
  if (revs.error) return <ErrorBox msg={revs.error.includes('boq_revisions') ? '내역서 표가 아직 없습니다. 서버에서 bash scripts/update.sh 를 실행해 주세요.' : revs.error} />;
  const list = revs.data || [];
  const cur = list.find((r) => r.id === sel) || list[list.length - 1];
  const boqDocs = (docs.data || []).filter((d) => d.category === 'design_boq');
  const contractAmt = (docs.data || []).find((d) => d.category === 'contract' && d.subcategory === '도급계약서' && d.contract_amount)?.contract_amount || p.prime_amount;
  const design = list.filter((r) => r.kind === 'design');

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
            {design.length > 0 && <button className="btn pri" onClick={() => setWizard(true)}>도급내역서 만들기</button>}
          </div>
        </div>
        {list.length === 0 && <Empty>아직 내역서가 없습니다. 아래에서 설계내역서 엑셀을 가져오세요.</Empty>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {list.map((r) => (
            <button key={r.id} className={'btn' + (cur?.id === r.id ? ' pri' : '')} onClick={() => setSel(r.id)} aria-pressed={cur?.id === r.id}>
              <Pill c={KIND[r.kind][1]}>{KIND[r.kind][0]}</Pill> {r.title}{r.kind === 'contract' && r.params?.rate ? ` · ${pctS(r.params.rate)}` : ''}
            </button>
          ))}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>설계 → 도급 → 변경 → 준공 순서입니다. 변경 · 준공내역서는 다음 단계에서 이어집니다.</div>
      </section>

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

      {cur && <RevView key={cur.id} rev={cur} base={list.find((r) => r.id === cur.base_id)} onDelete={() => doDelete(cur)} />}

      {wizard && <ContractWizard designs={design} defaultTarget={contractAmt} onClose={() => setWizard(false)}
        onDone={async (id) => { setWizard(false); await revs.reload(); setSel(id); toast('도급내역서를 만들었습니다'); }} />}
    </>
  );
}

/* ---------- 한 차수 보기 ---------- */
function RevView({ rev, base, onDelete }: { rev: Rev; base?: Rev; onDelete: () => void }) {
  const items = useLoad(() => fetchItems(rev.id), [rev.id]);
  const baseItems = useLoad(() => (base ? fetchItems(base.id) : Promise.resolve([])), [base?.id]);
  const [section, setSection] = useState<'summary' | 'detail'>('detail');
  const [open, setOpen] = useState<Record<number, boolean>>({});
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
      if (section === 'summary') return true;
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
        <h2><Pill c={KIND[rev.kind][1]}>{KIND[rev.kind][0]}</Pill> {rev.title}</h2>
        <div className="row">
          <button className="btn" onClick={() => download(rev.storage_path, rev.file_name)}>엑셀 내려받기</button>
          <button className="btn sm" onClick={onDelete}>지우기</button>
        </div>
      </div>
      <div className="muted">{rev.file_name} · 시트 '{rev.sheet_name}' · {dt(rev.created_at)} · {rev.profiles?.name || rev.profiles?.username || ''}</div>
      {chk && (chk.diffCount ? <div className="banner">엑셀에 저장된 값과 프로그램 계산이 {chk.diffCount}곳 다릅니다 (예: {chk.diffs.slice(0, 3).map((d: any) => `${d.cell} 엑셀 ${won(d.excel)} / 계산 ${won(d.calc)}`).join(', ')}). 엑셀에서 다시 저장한 뒤 올려 보세요.</div>
        : <div className="banner teal">금액 {chk.checked.toLocaleString()}칸을 다시 계산해 엑셀과 모두 일치합니다.</div>)}
      {res && <div className="banner blue">낙찰률 {pctS(res.rate)} 적용 · 단가 {res.changedCells}칸 변경 · 고정 {res.fixedCells}칸 · 이윤 조정 {won(res.profitAdjust)}원 · 이윤율 {(res.profitRate * 100).toFixed(2)}%</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {TOT.filter(([k]) => t[k]).map(([k, l]) => (
          <div key={k} className="card" style={{ padding: 12, gap: 2, background: k === 'contract' ? 'var(--blue-l)' : undefined }}>
            <span className="muted">{l}</span><b className="num">{won(t[k])}</b>
            {base && bt[k] ? <span className="muted num">설계 {won(bt[k])} ({t[k] - bt[k] >= 0 ? '+' : ''}{won(t[k] - bt[k])})</span> : null}
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="seg" role="group" aria-label="보기">
          <button className={section === 'detail' ? 'on' : ''} aria-pressed={section === 'detail'} onClick={() => setSection('detail')}>공종별 내역</button>
          <button className={section === 'summary' ? 'on' : ''} aria-pressed={section === 'summary'} onClick={() => setSection('summary')}>원가계산서</button>
        </div>
        <div className="row">
          {section === 'detail' && !find && <>
            <button className="btn sm" onClick={() => setOpen(Object.fromEntries((items.data || []).filter((i: Item) => i.kind === 'group').map((i: Item) => [i.row, true])))}>모두 펼치기</button>
            <button className="btn sm" onClick={() => setOpen({})}>접기</button></>}
          <input className="input" style={{ width: 180 }} placeholder="공종 찾기" value={find} onChange={(e) => setFind(e.target.value)} aria-label="공종 찾기" />
        </div>
      </div>

      {items.loading ? <Loading /> : items.error ? <ErrorBox msg={items.error} /> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>행</th><th>공종명</th><th>규격</th><th className="c">단위</th><th className="r">수량</th><th className="r">재료비 단가</th><th className="r">노무비 단가</th><th className="r">경비 단가</th><th className="r">합계 금액</th>{base && <th className="r">설계 대비</th>}</tr></thead>
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
                    <td className="r">{won(i.total_amt)}</td>
                    {base && <td className="r num" style={{ color: diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--teal)' : 'var(--sub)' }}>{b && diff ? (diff > 0 ? '+' : '') + won(diff) : ''}</td>}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={base ? 10 : 9} className="sub">찾는 공종이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function fetchItems(revId: string) {
  const out: Item[] = [];
  for (let from = 0; ; from += 1000) {
    const part = await q<Item[]>(sb.from('boq_items').select('*').eq('revision_id', revId).order('row').range(from, from + 999));
    out.push(...part); if (part.length < 1000) break;
  }
  return out;
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
    if (res.profitRate > 0.15) warn.push(`이윤율이 ${(res.profitRate * 100).toFixed(2)}%로 15%를 넘습니다. 계약금액이나 낙찰률을 다시 확인하세요.`);
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
            <tr><td>이윤 (설계 {won(res.designProfit)})</td><td className="r">{won(res.profit)} · {(res.profitRate * 100).toFixed(2)}%</td></tr>
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
