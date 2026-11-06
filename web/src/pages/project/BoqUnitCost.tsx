// ④ 내역서 — 변경 때 새로 쓰는 일위대가(호표) · 단가산출서
//  엑셀에서는 '신규 일위대가' · '신규 단가산출' 시트가 되고, 변경내역서 단가가 '적용 단가' 칸을 수식으로 가리킵니다.
import { useMemo, useState } from 'react';
import { api, q, sb } from '../../lib/supabase';
import { download, upload } from '../../lib/files';
import { mul, qty as fq, won } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Pill, Modal, Seg } from '../../lib/ui';

export type Price = { v?: number; f?: string; quote?: string };
export type Line = { name: string; spec?: string; unit?: string; qty: any; mat?: Price; lab?: Price; exp?: Price; src?: string };
export type UC = { id: string; seq: number; name: string; spec?: string; unit?: string; basis?: string; apply_rate: boolean; lines: Line[]; copied_from?: string };
export type Quote = { id: string; seq: number; name: string; spec?: string; unit?: string; sources: { price?: any; ref?: string; file_path?: string; file_name?: string }[]; method: 'min' | 'avg' | 'pick'; pick: number; note?: string };
const KEYS = ['mat', 'lab', 'exp'] as const;
const SRC = ['물가정보', '거래가격', '견적'];

/** 단가산출서 적용 단가 (엑셀: MIN / TRUNC(AVERAGE) / 고른 칸) */
export function quotePrice(qt?: Quote) {
  if (!qt) return 0;
  const vals = (qt.sources || []).map((s) => (s?.price === '' || s?.price == null ? null : Number(s.price)));
  const ok = vals.filter((v): v is number => v != null && !isNaN(v));
  if (qt.method === 'pick') return vals[qt.pick] ?? 0;
  if (!ok.length) return 0;
  return qt.method === 'avg' ? Math.trunc(ok.reduce((a, b) => a + b, 0) / ok.length) : Math.min(...ok);
}
const priceOf = (p: Price | undefined, quotes: Quote[]) => (p?.quote ? quotePrice(quotes.find((x) => x.id === p.quote)) : Number(p?.v || 0));

/** 일위대가 계산 (엑셀 시트와 같은 규칙: 줄 금액 TRUNC(단가×수량), 합 TRUNC, 적용 단가 TRUNC(합×낙찰률)) */
export function calcUC(uc: UC | undefined, quotes: Quote[], rate?: number) {
  const sum = { mat: 0, lab: 0, exp: 0 };
  for (const ln of uc?.lines || []) for (const k of KEYS) sum[k] += mul(priceOf(ln[k], quotes), Number(ln.qty || 0));
  const useRate = uc?.apply_rate !== false && !!rate;
  const ap = { mat: useRate ? mul(sum.mat, rate!) : sum.mat, lab: useRate ? mul(sum.lab, rate!) : sum.lab, exp: useRate ? mul(sum.exp, rate!) : sum.exp };
  return { sum, ap, total: ap.mat + ap.lab + ap.exp, useRate };
}

export const loadUnits = async (revId: string) => {
  const [ucs, qs] = await Promise.all([
    q<UC[]>(sb.from('boq_unit_costs').select('*').eq('revision_id', revId).order('seq')),
    q<Quote[]>(sb.from('boq_quotes').select('*').eq('revision_id', revId).order('seq')),
  ]);
  return { ucs, qs };
};

/* ---------- 목록 화면 ---------- */
export function UnitPanel({ rev, draft, rate, ucs, qs, used, onChange }: { rev: any; draft: boolean; rate?: number; ucs: UC[]; qs: Quote[]; used: Set<string>; onChange: () => void }) {
  const toast = useToast();
  const [ed, setEd] = useState<UC | 'new' | null>(null);
  const [qed, setQed] = useState<Quote | 'new' | null>(null);
  const [copy, setCopy] = useState(false);
  const delUC = async (u: UC) => {
    if (used.has(u.id)) return toast('내역서 항목이 이 일위대가를 쓰고 있습니다. 연결을 먼저 푸세요');
    if (!confirm(`'신규 ${u.seq} ${u.name}'을(를) 지울까요?`)) return;
    try { await q(sb.from('boq_unit_costs').delete().eq('id', u.id)); onChange(); } catch (e: any) { toast(e.message); }
  };
  const delQ = async (x: Quote) => {
    if (ucs.some((u) => u.lines.some((l) => KEYS.some((k) => l[k]?.quote === x.id)))) return toast('일위대가가 이 단가산출서를 쓰고 있습니다');
    if (!confirm(`'${x.name}' 단가산출서를 지울까요?`)) return;
    try { await q(sb.from('boq_quotes').delete().eq('id', x.id)); onChange(); } catch (e: any) { toast(e.message); }
  };
  return (
    <>
      <div className="banner blue"><span>변경 때 새로 생긴 공종의 단가를 <b>일위대가</b>(재료 · 노무 · 경비를 수량만큼)와 <b>단가산출서</b>(물가정보 · 거래가격 · 견적 비교)로 씁니다. 엑셀에는 '신규 일위대가' · '신규 단가산출' 시트로 들어가고, 내역서의 변경 단가가 수식으로 연결됩니다. 기존 호표는 도급 기준이라 그대로 두고, 고칠 때는 복사해서 새로 만듭니다.</span></div>
      <div className="card-h"><h3 style={{ fontSize: 16 }}>신규 일위대가 {ucs.length}개</h3>
        {draft && <div className="row"><button className="btn" onClick={() => setCopy(true)}>기존 호표 복사</button><button className="btn pri" onClick={() => setEd('new')}>+ 새 일위대가</button></div>}</div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>호표</th><th>공종명</th><th>규격</th><th className="c">단위</th><th className="r">재료비</th><th className="r">노무비</th><th className="r">경비</th><th className="r">적용 단가 합계</th><th>쓰는 곳</th><th></th></tr></thead>
        <tbody>
          {ucs.map((u) => { const c = calcUC(u, qs, rate); return (
            <tr key={u.id}>
              <td>신규 {u.seq}</td><td><b>{u.name}</b>{u.copied_from ? <div className="muted">복사: {u.copied_from}</div> : null}</td><td className="sub">{u.spec}</td><td className="c">{u.unit}</td>
              <td className="r">{won(c.ap.mat)}</td><td className="r">{won(c.ap.lab)}</td><td className="r">{won(c.ap.exp)}</td>
              <td className="r"><b>{won(c.total)}</b>{c.useRate ? <div className="muted">낙찰률 적용</div> : null}</td>
              <td>{used.has(u.id) ? <Pill c="green">연결됨</Pill> : <span className="muted">아직 없음</span>}</td>
              <td className="r"><button className="btn sm" onClick={() => setEd(u)}>{draft ? '고치기' : '보기'}</button>{draft && <button className="btn sm" style={{ marginLeft: 4 }} onClick={() => delUC(u)}>지우기</button>}</td>
            </tr>); })}
          {!ucs.length && <tr><td colSpan={10} className="sub">아직 없습니다.</td></tr>}
        </tbody>
      </table></div>

      <div className="card-h"><h3 style={{ fontSize: 16 }}>단가산출서 {qs.length}개</h3>
        {draft && <button className="btn pri" onClick={() => setQed('new')}>+ 새 단가산출서</button>}</div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>품명</th><th>규격</th><th className="c">단위</th>{SRC.map((s) => <th key={s} className="r">{s}</th>)}<th className="c">적용 기준</th><th className="r">적용 단가</th><th></th></tr></thead>
        <tbody>
          {qs.map((x) => (
            <tr key={x.id}>
              <td><b>{x.name}</b></td><td className="sub">{x.spec}</td><td className="c">{x.unit}</td>
              {[0, 1, 2].map((k) => <td key={k} className="r">{x.sources?.[k]?.price != null && x.sources[k].price !== '' ? won(x.sources[k].price) : '-'}{x.sources?.[k]?.file_path ? ' 📎' : ''}</td>)}
              <td className="c">{x.method === 'avg' ? '평균' : x.method === 'pick' ? SRC[x.pick] : '최저가'}</td>
              <td className="r"><b>{won(quotePrice(x))}</b></td>
              <td className="r"><button className="btn sm" onClick={() => setQed(x)}>{draft ? '고치기' : '보기'}</button>{draft && <button className="btn sm" style={{ marginLeft: 4 }} onClick={() => delQ(x)}>지우기</button>}</td>
            </tr>))}
          {!qs.length && <tr><td colSpan={9} className="sub">아직 없습니다. 자재 단가를 새로 정해야 할 때 씁니다.</td></tr>}
        </tbody>
      </table></div>

      {ed && <UCEditor rev={rev} uc={ed === 'new' ? null : ed} next={Math.max(0, ...ucs.map((u) => u.seq)) + 1} draft={draft} rate={rate} qs={qs} onClose={() => setEd(null)} onSaved={() => { setEd(null); onChange(); }} />}
      {qed && <QuoteEditor rev={rev} qt={qed === 'new' ? null : qed} next={Math.max(0, ...qs.map((u) => u.seq)) + 1} draft={draft} onClose={() => setQed(null)} onSaved={() => { setQed(null); onChange(); }} />}
      {copy && <BlockPicker rev={rev} onClose={() => setCopy(false)} onPick={(b) => {
        setCopy(false);
        setEd({ id: '', seq: Math.max(0, ...ucs.map((u) => u.seq)) + 1, name: b.name, spec: b.spec, unit: b.unit, apply_rate: true, lines: b.lines, copied_from: `${b.sheet} ${b.code || b.row + '행'}` } as UC);
      }} />}
    </>
  );
}

/* ---------- 단가 자료 (기준 엑셀) ---------- */
const refsCache = new Map<string, Promise<any>>();
const useRefs = (revId: string) => useLoad(() => { if (!refsCache.has(revId)) refsCache.set(revId, api('/api/boq/refs', { revision_id: revId }).catch((e) => { refsCache.delete(revId); throw e; })); return refsCache.get(revId)!; }, [revId]);

function BlockPicker({ rev, onClose, onPick }: { rev: any; onClose: () => void; onPick: (b: any) => void }) {
  const refs = useRefs(rev.id);
  const [f, setF] = useState('');
  const list = (refs.data?.blocks || []).filter((b: any) => !f || (b.code + b.name + b.spec).replace(/\s/g, '').includes(f.replace(/\s/g, '')));
  return (
    <Modal title="기존 호표 복사" onClose={onClose} wide>
      <p className="sub">기준 엑셀의 일위대가 호표입니다. 고르면 내용을 복사한 새 일위대가가 열리고, 고쳐서 저장합니다. 원래 호표는 바뀌지 않습니다.</p>
      <input className="input" placeholder="호표 찾기 (예: 무수축, No.3)" value={f} onChange={(e) => setF(e.target.value)} autoFocus aria-label="호표 찾기" />
      {refs.loading ? <Loading /> : refs.error ? <ErrorBox msg={refs.error} /> : (
        <div className="tbl-wrap" style={{ maxHeight: 460, overflow: 'auto' }}><table className="tbl">
          <thead><tr><th>호표</th><th>공종명</th><th>규격</th><th className="c">단위</th><th className="r">재료비</th><th className="r">노무비</th><th className="r">경비</th><th className="r">줄</th></tr></thead>
          <tbody>{list.map((b: any) => (
            <tr key={b.sheet + b.row} className="click" onClick={() => onPick(b)}>
              <td className="muted">{b.code || b.row + '행'}</td><td><b>{b.name}</b></td><td className="sub">{b.spec}</td><td className="c">{b.unit}</td>
              <td className="r">{won(b.mat)}</td><td className="r">{won(b.lab)}</td><td className="r">{won(b.exp)}</td><td className="r">{b.lines.length}</td></tr>))}
            {!list.length && <tr><td colSpan={8} className="sub">기준 엑셀에서 호표 시트를 찾지 못했습니다.</td></tr>}
          </tbody></table></div>)}
    </Modal>
  );
}

function RefPicker({ rev, qs, onClose, onPick }: { rev: any; qs: Quote[]; onClose: () => void; onPick: (line: Line) => void }) {
  const refs = useRefs(rev.id);
  const [tab, setTab] = useState<'material' | 'labor' | 'triple' | 'quote'>('material');
  const [f, setF] = useState('');
  const m = (s: string) => !f || s.replace(/\s/g, '').toLowerCase().includes(f.replace(/\s/g, '').toLowerCase());
  const prices = (refs.data?.prices || []).filter((p: any) => (tab === 'material' ? ['material', 'price'].includes(p.kind) : p.kind === tab) && m(p.name + p.spec + p.sheet));
  const pick = (p: any) => {
    const base = { name: p.name, spec: p.spec, unit: p.unit, qty: 1, src: `${p.sheet} ${p.row}행` };
    if (p.kind === 'triple') onPick({ ...base, mat: p.mat, lab: p.lab, exp: p.exp });
    else if (p.kind === 'labor') onPick({ ...base, lab: p.price });
    else onPick({ ...base, mat: p.price });
  };
  return (
    <Modal title="단가 자료에서 넣기" onClose={onClose} wide>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Seg label="자료" value={tab} onChange={setTab} items={[['material', '자재'], ['labor', '노임'], ['triple', '목록 (일위대가 · 중기 · 경비)'], ['quote', `단가산출서 (${qs.length})`]]} />
        <input className="input" style={{ width: 220 }} placeholder="찾기" value={f} onChange={(e) => setF(e.target.value)} aria-label="단가 찾기" />
      </div>
      <p className="muted">넣은 단가는 엑셀에서 원래 칸을 가리키는 수식(예: ='노임'!D5)으로 들어가, 단가표가 바뀌면 같이 바뀝니다.</p>
      {tab === 'quote' ? (
        <div className="tbl-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="tbl"><tbody>
          {qs.filter((x) => m(x.name + (x.spec || ''))).map((x) => (
            <tr key={x.id} className="click" onClick={() => onPick({ name: x.name, spec: x.spec, unit: x.unit, qty: 1, mat: { quote: x.id }, src: '신규 단가산출' })}>
              <td><b>{x.name}</b></td><td className="sub">{x.spec}</td><td className="c">{x.unit}</td><td className="r">{won(quotePrice(x))}</td></tr>))}
          {!qs.length && <tr><td className="sub">단가산출서를 먼저 만드세요.</td></tr>}
        </tbody></table></div>
      ) : refs.loading ? <Loading /> : refs.error ? <ErrorBox msg={refs.error} /> : (
        <div className="tbl-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="tbl">
          <thead><tr><th>시트</th><th>명칭</th><th>규격</th><th className="c">단위</th>{tab === 'triple' ? <><th className="r">재료비</th><th className="r">노무비</th><th className="r">경비</th></> : <th className="r">단가</th>}</tr></thead>
          <tbody>{prices.slice(0, 300).map((p: any) => (
            <tr key={p.sheet + p.row} className="click" onClick={() => pick(p)}>
              <td className="muted">{p.sheet}</td><td><b>{p.name}</b></td><td className="sub">{p.spec}</td><td className="c">{p.unit}</td>
              {tab === 'triple' ? <><td className="r">{won(p.mat.v)}</td><td className="r">{won(p.lab.v)}</td><td className="r">{won(p.exp.v)}</td></> : <td className="r">{won(p.price.v)}</td>}
            </tr>))}
            {!prices.length && <tr><td colSpan={7} className="sub">찾는 자료가 없습니다.</td></tr>}
          </tbody></table></div>)}
    </Modal>
  );
}

/* ---------- 일위대가 고치기 ---------- */
function UCEditor({ rev, uc, next, draft, rate, qs, onClose, onSaved }: { rev: any; uc: UC | null; next: number; draft: boolean; rate?: number; qs: Quote[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<UC>(() => uc ? JSON.parse(JSON.stringify(uc)) : { id: '', seq: next, name: '', spec: '', unit: '', basis: '', apply_rate: true, lines: [] });
  const [pick, setPick] = useState(false);
  const [err, setErr] = useState('');
  const c = useMemo(() => calcUC(f, qs, rate), [f, qs, rate]);
  const setLine = (i: number, x: Partial<Line>) => setF({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...x } : l)) });
  const setPrice = (i: number, k: typeof KEYS[number], v: string) => setLine(i, { [k]: v === '' ? undefined : { v: Number(v) } } as any);
  const move = (i: number, d: number) => { const L = [...f.lines]; const j = i + d; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; setF({ ...f, lines: L }); };
  const save = async () => {
    setErr('');
    const row = { name: f.name.trim(), spec: f.spec || null, unit: f.unit || null, basis: f.basis || null, apply_rate: f.apply_rate, lines: f.lines.map((l) => ({ ...l, qty: Number(l.qty) || 0 })), copied_from: f.copied_from || null, updated_at: new Date().toISOString() };
    try {
      if (f.id) await q(sb.from('boq_unit_costs').update(row).eq('id', f.id));
      else await q(sb.from('boq_unit_costs').insert({ ...row, seq: f.seq, project_id: rev.project_id, revision_id: rev.id }));
      onSaved();
    } catch (e: any) { setErr(e.message); }
  };
  const cell = (ln: Line, i: number, k: typeof KEYS[number]) => {
    const p = ln[k];
    if (p?.quote) { const qt = qs.find((x) => x.id === p.quote); return <span className="num">{won(quotePrice(qt))} <Pill c="green">산출: {qt?.name || '?'}</Pill>{draft && <button className="btn sm" aria-label="연결 풀기" onClick={() => setLine(i, { [k]: { v: quotePrice(qt) } } as any)}>✕</button>}</span>; }
    if (p?.f) return <span className="num">{won(p.v)} <Pill c="blue">{p.f.replace(/^'([^']+)'!/, '$1 ')}</Pill>{draft && <button className="btn sm" aria-label="연결 풀기" onClick={() => setLine(i, { [k]: { v: p.v } } as any)}>✕</button>}</span>;
    return draft ? <input className="input num" style={{ width: 96, height: 34, textAlign: 'right' }} inputMode="decimal" value={p?.v ?? ''} onChange={(e) => setPrice(i, k, e.target.value.replace(/[^\d.]/g, ''))} aria-label={`${ln.name} ${k} 단가`} /> : <span className="num">{won(p?.v)}</span>;
  };
  const ok = f.name.trim() && f.lines.length > 0;
  return (
    <Modal title={uc?.id ? `신규 ${f.seq} 일위대가` : `새 일위대가 · 신규 ${f.seq}`} onClose={onClose} wide
      foot={draft ? <><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!ok} onClick={save}>저장</button></> : <button className="btn" onClick={onClose}>닫기</button>}>
      {f.copied_from && <div className="muted">복사한 호표: {f.copied_from}</div>}
      <div className="grid" style={{ gridTemplateColumns: '2fr 1.4fr 0.8fr 2fr', gap: 10 }}>
        <div className="field"><label htmlFor="u1">공종명</label><input id="u1" className="input" value={f.name} disabled={!draft} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="u2">규격</label><input id="u2" className="input" value={f.spec || ''} disabled={!draft} onChange={(e) => setF({ ...f, spec: e.target.value })} /></div>
        <div className="field"><label htmlFor="u3">단위</label><input id="u3" className="input" value={f.unit || ''} disabled={!draft} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
        <div className="field"><label htmlFor="u4">산출 근거</label><input id="u4" className="input" placeholder="예: 표준품셈 3-2-1" value={f.basis || ''} disabled={!draft} onChange={(e) => setF({ ...f, basis: e.target.value })} /></div>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>품명</th><th>규격</th><th className="c">단위</th><th className="r">수량</th><th className="r">재료비 단가</th><th className="r">노무비 단가</th><th className="r">경비 단가</th><th className="r">금액</th>{draft && <th></th>}</tr></thead>
        <tbody>
          {f.lines.map((ln, i) => {
            const amt = KEYS.reduce((s, k) => s + mul(priceOf(ln[k], qs), Number(ln.qty || 0)), 0);
            return (
              <tr key={i}>
                <td>{draft ? <input className="input" style={{ minWidth: 140, height: 34 }} value={ln.name} onChange={(e) => setLine(i, { name: e.target.value })} aria-label="품명" /> : ln.name}{ln.src ? <div className="muted">{ln.src}</div> : null}</td>
                <td>{draft ? <input className="input" style={{ width: 120, height: 34 }} value={ln.spec || ''} onChange={(e) => setLine(i, { spec: e.target.value })} aria-label="규격" /> : ln.spec}</td>
                <td className="c">{draft ? <input className="input" style={{ width: 56, height: 34 }} value={ln.unit || ''} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label="단위" /> : ln.unit}</td>
                <td className="r">{draft ? <input className="input num" style={{ width: 76, height: 34, textAlign: 'right' }} inputMode="decimal" value={ln.qty ?? ''} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^\d.]/g, '') })} aria-label="수량" /> : fq(ln.qty)}</td>
                {KEYS.map((k) => <td key={k} className="r">{cell(ln, i, k)}</td>)}
                <td className="r num">{won(amt)}</td>
                {draft && <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" aria-label="위로" onClick={() => move(i, -1)}>↑</button>
                  <button className="btn sm" aria-label="아래로" onClick={() => move(i, 1)}>↓</button>
                  <button className="btn sm" onClick={() => setF({ ...f, lines: f.lines.filter((_, k) => k !== i) })}>빼기</button></td>}
              </tr>);
          })}
          {!f.lines.length && <tr><td colSpan={9} className="sub">아래 버튼으로 재료 · 노무 · 경비 줄을 넣으세요.</td></tr>}
        </tbody>
        <tfoot>
          <tr><td colSpan={4}>계 (1{f.unit || '단위'}당)</td><td className="r">{won(c.sum.mat)}</td><td className="r">{won(c.sum.lab)}</td><td className="r">{won(c.sum.exp)}</td><td className="r">{won(c.sum.mat + c.sum.lab + c.sum.exp)}</td>{draft && <td />}</tr>
          <tr><td colSpan={4}>적용 단가{c.useRate ? ` (낙찰률 ${(rate! * 100).toFixed(3)}%)` : ''}</td><td className="r">{won(c.ap.mat)}</td><td className="r">{won(c.ap.lab)}</td><td className="r">{won(c.ap.exp)}</td><td className="r">{won(c.total)}</td>{draft && <td />}</tr>
        </tfoot>
      </table></div>
      {draft && <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => setPick(true)}>+ 단가 자료에서 (자재 · 노임 · 목록 · 단가산출서)</button>
        <button className="btn" onClick={() => setF({ ...f, lines: [...f.lines, { name: '', unit: '', qty: 1 }] })}>+ 직접 입력 줄</button>
        {rate ? <label className="row" style={{ gap: 8, minHeight: 44 }}><input type="checkbox" checked={f.apply_rate} onChange={(e) => setF({ ...f, apply_rate: e.target.checked })} style={{ width: 20, height: 20 }} /> 적용 단가에 낙찰률 곱하기 (설계 기준 단가일 때)</label> : null}
      </div>}
      <div className="muted">금액 = TRUNC(단가 × 수량). 공구손료처럼 %로 붙는 금액은 수량 1에 금액을 단가로 넣으세요.</div>
      {err && <div className="banner red">{err}</div>}
      {pick && <RefPicker rev={rev} qs={qs} onClose={() => setPick(false)} onPick={(ln) => { setF((x) => ({ ...x, lines: [...x.lines, ln] })); setPick(false); }} />}
    </Modal>
  );
}

/* ---------- 단가산출서 고치기 ---------- */
function QuoteEditor({ rev, qt, next, draft, onClose, onSaved }: { rev: any; qt: Quote | null; next: number; draft: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Quote>(() => qt ? JSON.parse(JSON.stringify({ ...qt, sources: [0, 1, 2].map((k) => qt.sources?.[k] || {}) })) : { id: '', seq: next, name: '', spec: '', unit: '', sources: [{}, {}, {}], method: 'min', pick: 0 });
  const [busy, setBusy] = useState(-1);
  const [err, setErr] = useState('');
  const setS = (k: number, x: any) => setF({ ...f, sources: f.sources.map((s, i) => (i === k ? { ...s, ...x } : s)) });
  const attach = async (k: number, file?: File) => {
    if (!file) return;
    setBusy(k);
    try { const { path } = await upload(rev.project_id, 'boq/quotes', file); setS(k, { file_path: path, file_name: file.name }); } catch (e: any) { toast(e.message); }
    setBusy(-1);
  };
  const save = async () => {
    setErr('');
    const row = { name: f.name.trim(), spec: f.spec || null, unit: f.unit || null, method: f.method, pick: f.pick, note: f.note || null,
      sources: f.sources.map((s) => ({ ...s, price: s.price === '' || s.price == null ? null : Math.trunc(Number(s.price)) })), updated_at: new Date().toISOString() };
    try {
      if (f.id) await q(sb.from('boq_quotes').update(row).eq('id', f.id));
      else await q(sb.from('boq_quotes').insert({ ...row, seq: f.seq, project_id: rev.project_id, revision_id: rev.id }));
      onSaved();
    } catch (e: any) { setErr(e.message); }
  };
  const applied = quotePrice(f);
  return (
    <Modal title={qt ? `단가산출서 · ${qt.name}` : '새 단가산출서'} onClose={onClose}
      foot={draft ? <><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!f.name.trim()} onClick={save}>저장</button></> : <button className="btn" onClick={onClose}>닫기</button>}>
      <div className="grid" style={{ gridTemplateColumns: '2fr 1.4fr 0.8fr', gap: 10 }}>
        <div className="field"><label htmlFor="q1">품명</label><input id="q1" className="input" value={f.name} disabled={!draft} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="q2">규격</label><input id="q2" className="input" value={f.spec || ''} disabled={!draft} onChange={(e) => setF({ ...f, spec: e.target.value })} /></div>
        <div className="field"><label htmlFor="q3">단위</label><input id="q3" className="input" value={f.unit || ''} disabled={!draft} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>자료</th><th className="r">단가</th><th>출처 (책 · 쪽 · 업체)</th><th>증빙</th></tr></thead>
        <tbody>{SRC.map((lb, k) => (
          <tr key={lb} style={{ background: f.method === 'pick' && f.pick === k ? 'var(--blue-l)' : undefined }}>
            <td>{lb}</td>
            <td className="r">{draft ? <input className="input num" style={{ width: 110, height: 34, textAlign: 'right' }} inputMode="numeric" value={f.sources[k]?.price ?? ''} onChange={(e) => setS(k, { price: e.target.value.replace(/\D/g, '') })} aria-label={lb + ' 단가'} /> : won(f.sources[k]?.price)}</td>
            <td>{draft ? <input className="input" style={{ height: 34 }} placeholder={k === 2 ? '예: ○○산업 2026.11 견적' : '예: 2026.10 p.474'} value={f.sources[k]?.ref || ''} onChange={(e) => setS(k, { ref: e.target.value })} aria-label={lb + ' 출처'} /> : f.sources[k]?.ref}</td>
            <td>{f.sources[k]?.file_path
              ? <><button className="btn sm" onClick={() => download(f.sources[k].file_path!, f.sources[k].file_name || '증빙')}>📎 {f.sources[k].file_name}</button>{draft && <button className="btn sm" aria-label="증빙 빼기" onClick={() => setS(k, { file_path: undefined, file_name: undefined })}>✕</button>}</>
              : draft ? <label className="btn sm" style={{ cursor: 'pointer' }}>{busy === k ? '올리는 중…' : '파일 첨부'}<input type="file" hidden onChange={(e) => attach(k, e.target.files?.[0])} /></label> : '-'}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Seg label="적용 기준" value={f.method} onChange={(m) => draft && setF({ ...f, method: m })} items={[['min', '최저가'], ['avg', '평균'], ['pick', '직접 선택']]} />
        {f.method === 'pick' && <select className="input" style={{ width: 140 }} value={f.pick} disabled={!draft} onChange={(e) => setF({ ...f, pick: +e.target.value })} aria-label="고른 자료">{SRC.map((s, k) => <option key={s} value={k}>{s}</option>)}</select>}
        <b style={{ marginLeft: 'auto' }}>적용 단가 {won(applied)}원</b>
      </div>
      <div className="muted">엑셀에는 {f.method === 'avg' ? '=TRUNC(AVERAGE(물가정보:견적),0)' : f.method === 'pick' ? `=${SRC[f.pick]} 칸` : '=MIN(물가정보:견적)'} 수식으로 들어갑니다. 빈 칸은 계산에서 빠집니다.</div>
      {err && <div className="banner red">{err}</div>}
    </Modal>
  );
}

/* ---------- 내역서 항목 ↔ 일위대가 연결 ---------- */
export function LinkModal({ item, ucs, qs, rate, current, onClose, onPick }: { item: any; ucs: UC[]; qs: Quote[]; rate?: number; current?: string; onClose: () => void; onPick: (id: string | null) => void }) {
  return (
    <Modal title={`단가 연결 · ${item.name}`} onClose={onClose}>
      <p className="sub">고른 일위대가의 적용 단가가 이 항목의 변경 단가(재료비 · 노무비 · 경비)가 됩니다. 엑셀에서는 '신규 일위대가' 시트 칸을 가리키는 수식입니다.</p>
      <div className="tbl-wrap"><table className="tbl"><tbody>
        {ucs.map((u) => { const c = calcUC(u, qs, rate); return (
          <tr key={u.id} className="click" onClick={() => onPick(u.id)} style={{ background: current === u.id ? 'var(--blue-l)' : undefined }}>
            <td>신규 {u.seq}</td><td><b>{u.name}</b> <span className="sub">{u.spec}</span></td><td className="c">{u.unit}</td>
            <td className="r">{won(c.ap.mat)} / {won(c.ap.lab)} / {won(c.ap.exp)}</td><td className="r"><b>{won(c.total)}</b></td></tr>); })}
        {!ucs.length && <tr><td className="sub">'신규 단가' 탭에서 일위대가를 먼저 만드세요.</td></tr>}
      </tbody></table></div>
      {current && <button className="btn" onClick={() => onPick(null)}>연결 풀기 (당초 단가로)</button>}
    </Modal>
  );
}
