// ④ 내역서 — 변경내역서 (당초 / 변경 두 줄) · 확정 · 잠금 해제 · 이력
import { Fragment, useMemo, useState } from 'react';
import { api, q, sb } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { download } from '../../lib/files';
import { dt, mul, qty as fq, won } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Pill, Modal, Seg } from '../../lib/ui';

type Rev = any; type Item = any;
type Rule = { top: 'change' | 'orig'; orig_color: string; chg_color: string; merge_text: boolean };
type NewItem = { id: string; parent_row: number; name: string; spec: string; unit: string; qty: any; mat_price: any; lab_price: any; exp_price: any; note?: string };
type Edit = { qty?: any; mat_price?: any; lab_price?: any; exp_price?: any };

export const RULE_DEFAULT: Rule = { top: 'change', orig_color: 'black', chg_color: 'red', merge_text: true };
const CSS_COLOR: Record<string, string> = { black: 'var(--text)', red: '#C62828', blue: '#1F4E8C' };
const COLOR_NAME: Record<string, string> = { black: '검정', red: '빨강', blue: '파랑' };
const CH: Record<string, [string, string]> = { qty: ['수량 변경', 'orange'], price: ['단가 변경', 'orange'], new: ['신규', 'green'], del: ['삭제', 'red'] };
const PRICE = ['mat_price', 'lab_price', 'exp_price'] as const;
const nz = (v: any) => (v === '' || v === null || v === undefined ? undefined : Number(String(v).replace(/,/g, '')));
const sign = (n: number) => (n > 0 ? '+' : '') + won(n);

export const fetchItems = async (revId: string) => {
  const out: Item[] = [];
  for (let from = 0; ; from += 1000) {
    const part = await q<Item[]>(sb.from('boq_items').select('*').eq('revision_id', revId).order('row').range(from, from + 999));
    out.push(...part); if (part.length < 1000) break;
  }
  return out;
};

/* ---------- 변경내역서 보기 · 고치기 ---------- */
export function ChangeView({ rev, rate, onChanged, onDelete }: { rev: Rev; rate?: number; onChanged: (sel?: string) => void; onDelete: () => void }) {
  const toast = useToast();
  const items = useLoad(() => fetchItems(rev.id), [rev.id, rev.totals?.contract, JSON.stringify(rev.params?.edits || {}), (rev.params?.new_items || []).length]);
  const draft = !rev.locked && rev.status !== 'confirmed';
  const rule: Rule = { ...RULE_DEFAULT, ...(rev.params?.rule || {}) };
  const [edits, setEdits] = useState<Record<string, Edit>>(() => JSON.parse(JSON.stringify(rev.params?.edits || {})));
  const [news, setNews] = useState<NewItem[]>(() => (rev.params?.new_items || []).map((x: any) => ({ ...x })));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<'detail' | 'summary'>('detail');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [closed, setClosed] = useState<Record<number, boolean>>({});
  const [addTo, setAddTo] = useState<{ parent: Item; edit?: NewItem } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unlock, setUnlock] = useState(false);
  const t = rev.totals || {}, ot = rev.params?.orig_totals || {};

  const all: Item[] = items.data || [];
  const byRow = useMemo(() => new Map(all.map((i) => [i.row, i])), [all]);
  const setE = (row: number, k: keyof Edit, v: string) => {
    setEdits((e) => { const x = { ...(e[row] || {}) }; if (v === '') delete x[k]; else x[k] = v; const n = { ...e, [row]: x }; if (!Object.keys(x).length) delete n[row]; return n; });
    setDirty(true);
  };
  const resetRow = (row: number) => { setEdits((e) => { const n = { ...e }; delete n[row]; return n; }); setDirty(true); };

  // 화면에서 바로 보이는 변경 금액 (저장하면 서버가 엑셀 수식으로 다시 계산)
  const live = (it: Item) => {
    const e = edits[it.row];
    if (!e || it.kind !== 'item') return null;
    const q0 = nz(e.qty) ?? Number(it.orig?.qty ?? it.qty);
    const ps = PRICE.map((k) => nz(e[k]) ?? Number(it.orig?.[k] ?? it[k] ?? 0));
    return { qty: q0, prices: ps, total: ps.reduce((s, p) => s + mul(q0, p), 0) };
  };
  const ancestorsOpen = (it: Item) => { let p = it.parent_row; while (p != null) { if (closed[p]) return false; p = byRow.get(p)?.parent_row ?? null; } return true; };
  const changedRows = useMemo(() => {
    const s = new Set<number>();
    const mark = (it: Item) => { let p: any = it; while (p) { s.add(p.row); p = byRow.get(p.parent_row); } };
    for (const it of all) if ((it.change && !['same', 'amt'].includes(it.change) && it.change !== 'new') || edits[it.row]) mark(it);
    for (const n of news) { const par = byRow.get(n.parent_row); if (par) mark(par); }
    return s;
  }, [all, edits, news, byRow]);

  const rows = all.filter((i) => i.section === section && i.change !== 'new' && ancestorsOpen(i) && (!onlyChanged || changedRows.has(i.row)));
  // 신규 항목을 붙일 자리: 보이는 줄 중 부모 묶음(또는 그 하위)의 마지막 줄
  const anchor = useMemo(() => {
    const m = new Map<number, number>();
    const under = (it: Item, p: number) => { let x: any = it; let d = 0; while (x && d < 30) { if (x.row === p) return true; x = byRow.get(x.parent_row); d++; } return false; };
    for (const n of news) { let a = -1; for (const r of rows) if (under(r, n.parent_row)) a = Math.max(a, r.row); if (a >= 0) m.set(n.parent_row, a); }
    return m;
  }, [rows, news, byRow]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api('/api/boq/change/save', { revision_id: rev.id, edits, new_items: news });
      toast(`저장했습니다 · 바뀐 항목 ${r.changed}개 · 변경 도급액 ${won(r.totals.contract)}원`);
      setDirty(false); onChanged(rev.id);
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  };

  const colorOf = (V: 'C' | 'O') => CSS_COLOR[V === 'C' ? rule.chg_color : rule.orig_color];
  const order: ('C' | 'O')[] = rule.top === 'change' ? ['C', 'O'] : ['O', 'C'];
  const ncols = 10;

  const pairRows = (it: Item) => {
    const isItem = it.kind === 'item';
    const lv = live(it);
    const o = it.orig || {};
    const ch = it.change;
    const isG = it.kind === 'group';
    const canAdd = draft && isG && section === 'detail';
    const totalC = lv ? lv.total : Number(it.total_amt);
    const diff = totalC - Number(o.total_amt ?? 0);
    return order.map((V, idx) => {
      const c = colorOf(V);
      const first = idx === 0;
      const val = (k: string) => (V === 'O' ? o[k] : it[k]);
      return (
        <tr key={it.row + V} style={{ color: c, background: isG && it.level === 0 ? 'var(--head)' : undefined, borderTop: first ? undefined : 'none' }}>
          {first && <td rowSpan={2} className="muted num" style={{ color: 'var(--sub)' }}>{it.row}</td>}
          {first && <td rowSpan={2} style={{ paddingLeft: 12 + (section === 'detail' ? it.level * 16 : 0), color: 'var(--text)', fontWeight: isG ? 600 : undefined, cursor: isG ? 'pointer' : undefined }}
            onClick={isG ? () => setClosed({ ...closed, [it.row]: !closed[it.row] }) : undefined}>
            {isG ? (closed[it.row] ? '▸ ' : '▾ ') : ''}{it.name}
            {ch && CH[ch] && <> <Pill c={CH[ch][1]}>{CH[ch][0]}</Pill></>}
            {JSON.stringify(edits[it.row] || null) !== JSON.stringify(rev.params?.edits?.[it.row] || null) && <> <Pill c="blue">저장 전</Pill></>}
            {canAdd && <button className="btn sm" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); setAddTo({ parent: it }); }}>+ 신규</button>}
          </td>}
          {first && <td rowSpan={2} className="sub" style={{ color: 'var(--sub)' }}>{it.spec}</td>}
          {first && <td rowSpan={2} className="c" style={{ color: 'var(--text)' }}>{it.unit}</td>}
          <td className="c" style={{ fontSize: 12 }}>{V === 'C' ? '변경' : '당초'}</td>
          <td className="r">{isItem ? (V === 'C' && draft
            ? <input className="input num" aria-label={`${it.name} 변경 수량`} style={{ width: 84, height: 34, textAlign: 'right', color: c }} inputMode="decimal"
              value={edits[it.row]?.qty ?? ''} placeholder={fq(it.orig?.qty ?? it.qty)} onChange={(e) => setE(it.row, 'qty', e.target.value.replace(/[^\d.]/g, ''))} />
            : fq(V === 'C' && lv ? lv.qty : val('qty'))) : ''}</td>
          {PRICE.map((k, pi) => (
            <td key={k} className="r">{isItem ? (V === 'C' && draft
              ? <input className="input num" aria-label={`${it.name} 변경 단가`} style={{ width: 100, height: 34, textAlign: 'right', color: c }} inputMode="numeric"
                value={edits[it.row]?.[k] ?? ''} placeholder={won(it.orig?.[k] ?? it[k])} onChange={(e) => setE(it.row, k, e.target.value.replace(/\D/g, ''))} />
              : won(V === 'C' && lv ? lv.prices[pi] : val(k))) : ''}</td>
          ))}
          <td className="r num" style={{ fontWeight: isG || it.kind === 'cost' ? 600 : undefined }}>{won(V === 'C' ? totalC : o.total_amt)}</td>
          {first && <td rowSpan={2} className="r num" style={{ color: diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--teal)' : 'var(--sub)' }}>
            {diff ? sign(diff) : ''}
            {draft && isItem && <div className="row" style={{ justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
              {edits[it.row] && <button className="btn sm" onClick={() => resetRow(it.row)}>되돌리기</button>}
              {Number(o.qty) > 0 && nz(edits[it.row]?.qty) !== 0 && <button className="btn sm" onClick={() => setE(it.row, 'qty', '0')}>삭제</button>}
            </div>}
          </td>}
        </tr>
      );
    });
  };

  const newRows = (n: NewItem, k: number) => {
    const par = byRow.get(n.parent_row);
    const ps = PRICE.map((p) => Number(n[p] || 0));
    const total = ps.reduce((s, p) => s + mul(Number(n.qty || 0), p), 0);
    return order.map((V, idx) => (
      <tr key={'n' + k + V} style={{ color: colorOf(V) }}>
        {idx === 0 && <td rowSpan={2} className="muted">신규</td>}
        {idx === 0 && <td rowSpan={2} style={{ paddingLeft: 12 + ((par?.level ?? 0) + 1) * 16, color: 'var(--text)' }}>{n.name} <Pill c="green">신규</Pill>
          {draft && <><button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setAddTo({ parent: par, edit: n })}>고치기</button>
            <button className="btn sm" style={{ marginLeft: 4 }} onClick={() => { setNews(news.filter((x) => x !== n)); setDirty(true); }}>빼기</button></>}</td>}
        {idx === 0 && <td rowSpan={2} className="sub">{n.spec}</td>}
        {idx === 0 && <td rowSpan={2} className="c" style={{ color: 'var(--text)' }}>{n.unit}</td>}
        <td className="c" style={{ fontSize: 12 }}>{V === 'C' ? '변경' : '당초'}</td>
        <td className="r">{V === 'C' ? fq(n.qty) : ''}</td>
        {ps.map((p, i) => <td key={i} className="r">{V === 'C' ? won(p) : ''}</td>)}
        <td className="r num">{V === 'C' ? won(total) : ''}</td>
        {idx === 0 && <td rowSpan={2} className="r num" style={{ color: 'var(--teal)' }}>{sign(total)}</td>}
      </tr>
    ));
  };

  const checks: any[] = rev.params?.checks || [];
  const counts = { qty: 0, price: 0, del: 0, new: news.length };
  for (const it of all) if (it.change && (counts as any)[it.change] !== undefined && it.change !== 'new') (counts as any)[it.change]++;

  return (
    <section className="card">
      <div className="card-h">
        <h2><Pill c="orange">변경</Pill> {rev.title} {draft ? <Pill c="orange">작성 중</Pill> : <Pill c="blue">🔒 확정</Pill>}</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => download(rev.storage_path, rev.file_name)} disabled={dirty} title={dirty ? '저장한 뒤 내려받으세요' : undefined}>엑셀 내려받기</button>
          {draft && <button className={'btn' + (dirty ? ' pri' : '')} disabled={busy || !dirty} onClick={save}>{busy ? '엑셀 다시 계산 중…' : dirty ? '저장' : '저장됨'}</button>}
          {draft && <button className="btn pri" disabled={dirty || busy} onClick={() => setConfirmOpen(true)} title={dirty ? '먼저 저장하세요' : undefined}>확정</button>}
          {!draft && <button className="btn" onClick={() => setUnlock(true)}>잠금 해제</button>}
          {draft && <button className="btn sm" onClick={onDelete}>지우기</button>}
        </div>
      </div>
      <div className="muted">{rev.file_name} · 시트 '{rev.sheet_name}' · 기준: {rev.params?.base_title || '직전 차수'} · 윗줄 {rule.top === 'change' ? '변경' : '당초'} · 당초 {COLOR_NAME[rule.orig_color]} / 변경 {COLOR_NAME[rule.chg_color]}{rule.merge_text ? ' · 품명 · 규격 · 단위 한 칸' : ''}{rev.confirmed_at ? ` · 확정 ${dt(rev.confirmed_at)}` : ''}</div>
      {draft && <div className="banner blue"><span>변경 줄의 수량 · 단가 칸에 바뀐 값만 넣고 <b>저장</b>을 누르세요. 비워 두면 당초와 같습니다. 엑셀에서 당초 단가는 값, 변경 단가는 당초 칸을 가리키는 수식(예: =G65)으로 들어갑니다.</span></div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
        {([['contract', '도급액'], ['direct', '직접공사비'], ['profit', '이윤'], ['grand', '총공사비']] as [string, string][]).filter(([k]) => t[k] != null).map(([k, l]) => (
          <div key={k} className="card" style={{ padding: 12, gap: 2, background: k === 'contract' ? 'var(--blue-l)' : undefined }}>
            <span className="muted">{l}</span>
            <span className="num" style={{ color: CSS_COLOR[rule.orig_color] }}>당초 {won(ot[k])}</span>
            <b className="num" style={{ color: CSS_COLOR[rule.chg_color] }}>변경 {won(t[k])}</b>
            <span className="muted num">증감 {sign(Number(t[k]) - Number(ot[k] || 0))}</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Seg label="보기" value={section} onChange={setSection} items={[['detail', '공종별 내역'], ['summary', '원가계산서']]} />
        <div className="row">
          <label className="row" style={{ gap: 6, minHeight: 44 }}><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} style={{ width: 20, height: 20 }} /> 바뀐 것만</label>
          <button className="btn sm" onClick={() => setClosed({})}>모두 펼치기</button>
          <button className="btn sm" onClick={() => setClosed(Object.fromEntries(all.filter((i) => i.kind === 'group' && i.level >= 1).map((i) => [i.row, true])))}>접기</button>
        </div>
      </div>

      {items.loading ? <Loading /> : items.error ? <ErrorBox msg={items.error} /> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>행</th><th>공종명</th><th>규격</th><th className="c">단위</th><th className="c">구분</th><th className="r">수량</th><th className="r">재료비 단가</th><th className="r">노무비 단가</th><th className="r">경비 단가</th><th className="r">합계 금액</th><th className="r">증감</th></tr></thead>
            <tbody>
              {rows.map((it) => (
                <Fragment key={it.row}>
                  {pairRows(it)}
                  {section === 'detail' && news.filter((n) => anchor.get(n.parent_row) === it.row && !closed[n.parent_row]).map((n, k) => newRows(n, k))}
                </Fragment>
              ))}
              {rows.length === 0 && <tr><td colSpan={ncols + 1} className="sub">{onlyChanged ? '아직 바뀐 항목이 없습니다.' : '항목이 없습니다.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {addTo && <NewItemModal parent={addTo.parent} init={addTo.edit} rate={rate} onClose={() => setAddTo(null)} onSave={(n) => {
        setNews(addTo.edit ? news.map((x) => (x === addTo.edit ? n : x)) : [...news, n]); setDirty(true); setAddTo(null);
      }} />}
      {confirmOpen && <ConfirmModal rev={rev} checks={checks} counts={counts} onClose={() => setConfirmOpen(false)} onDone={(fid) => { setConfirmOpen(false); toast('확정했습니다 · 준공내역서를 만들었습니다'); onChanged(fid); }} />}
      {unlock && <UnlockModal rev={rev} onClose={() => setUnlock(false)} onDone={() => { setUnlock(false); toast('잠금을 풀었습니다 · 이력에 남았습니다'); onChanged(rev.id); }} />}
    </section>
  );
}

/* ---------- 신규 항목 ---------- */
function NewItemModal({ parent, init, rate, onClose, onSave }: { parent: Item; init?: NewItem; rate?: number; onClose: () => void; onSave: (n: NewItem) => void }) {
  const [f, setF] = useState<NewItem>(init || { id: 'n' + Date.now(), parent_row: parent.row, name: '', spec: '', unit: '', qty: '', mat_price: '', lab_price: '', exp_price: '', note: '신규' });
  const [applyRate, setApplyRate] = useState(false);
  const set = (k: keyof NewItem, v: string) => setF({ ...f, [k]: v });
  const final = (k: 'mat_price' | 'lab_price' | 'exp_price') => { const v = Math.trunc(Number(f[k] || 0)); return applyRate && rate ? mul(v, rate) : v; };
  const total = (['mat_price', 'lab_price', 'exp_price'] as const).reduce((s, k) => s + mul(Number(f.qty || 0), final(k)), 0);
  const ok = f.name.trim() && Number(f.qty) > 0 && (['mat_price', 'lab_price', 'exp_price'] as const).some((k) => Number(f[k]) > 0);
  return (
    <Modal title={init ? '신규 항목 고치기' : `신규 항목 · ${parent?.name || ''}`} onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>취소</button>
        <button className="btn pri" disabled={!ok} onClick={() => onSave({ ...f, name: f.name.trim(), mat_price: final('mat_price'), lab_price: final('lab_price'), exp_price: final('exp_price') })}>넣기</button></>}>
      <p className="sub">변경 줄에만 들어가고 당초 줄은 비워 둡니다. 저장하면 '{parent?.name}' 소계와 그 위 합계에 더해집니다.</p>
      <div className="grid" style={{ gridTemplateColumns: '2fr 1.4fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="ni1">공종명</label><input id="ni1" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></div>
        <div className="field"><label htmlFor="ni2">규격</label><input id="ni2" className="input" value={f.spec} onChange={(e) => set('spec', e.target.value)} /></div>
        <div className="field"><label htmlFor="ni3">단위</label><input id="ni3" className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)} /></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <div className="field"><label htmlFor="ni4">수량</label><input id="ni4" className="input num" inputMode="decimal" value={f.qty} onChange={(e) => set('qty', e.target.value.replace(/[^\d.]/g, ''))} /></div>
        {([['mat_price', '재료비 단가'], ['lab_price', '노무비 단가'], ['exp_price', '경비 단가']] as const).map(([k, l]) => (
          <div key={k} className="field"><label htmlFor={'ni' + k}>{l}</label><input id={'ni' + k} className="input num" inputMode="numeric" value={f[k]} onChange={(e) => set(k, e.target.value.replace(/\D/g, ''))} /></div>))}
      </div>
      {rate ? <label className="row" style={{ gap: 8, minHeight: 44 }}><input type="checkbox" checked={applyRate} onChange={(e) => setApplyRate(e.target.checked)} style={{ width: 20, height: 20 }} />
        설계 단가를 넣었으면 낙찰률 {(rate * 100).toFixed(3)}% 적용 (원 미만 버림)</label> : null}
      <div className="muted">금액 {won(total)}원 = 재료비 {won(mul(Number(f.qty || 0), final('mat_price')))} + 노무비 {won(mul(Number(f.qty || 0), final('lab_price')))} + 경비 {won(mul(Number(f.qty || 0), final('exp_price')))}</div>
      <div className="muted">일위대가 · 단가산출서를 새로 써서 연결하는 기능은 다음 단계에서 붙입니다. 지금은 단가를 직접 넣습니다.</div>
    </Modal>
  );
}

/* ---------- 확정 ---------- */
function ConfirmModal({ rev, checks, counts, onClose, onDone }: { rev: Rev; checks: any[]; counts: any; onClose: () => void; onDone: (finalId?: string) => void }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const t = rev.totals || {}, ot = rev.params?.orig_totals || {};
  const pass = checks.every((c) => c.ok);
  const go = async () => {
    setBusy(true); setErr('');
    try { const r = await api('/api/boq/confirm', { revision_id: rev.id }); onDone(r.final_id); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={`${rev.title} 확정`} onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!ok || !pass || busy} onClick={go}>{busy ? '준공내역서 만드는 중…' : '확정하기'}</button></>}>
      <div className="tbl-wrap"><table className="tbl"><tbody>
        <tr><td>당초 도급액</td><td className="r num">{won(ot.contract)}</td></tr>
        <tr><td>변경 도급액</td><td className="r num"><b>{won(t.contract)}</b></td></tr>
        <tr><td>증감</td><td className="r num">{sign(Number(t.contract) - Number(ot.contract || 0))}</td></tr>
        <tr><td>항목</td><td className="r">수량 변경 {counts.qty} · 단가 변경 {counts.price} · 신규 {counts.new} · 삭제 {counts.del}</td></tr>
      </tbody></table></div>
      <h3 style={{ fontSize: 15 }}>확정 전 검사</h3>
      {checks.map((c) => <div key={c.label} className="row" style={{ gap: 8 }}><span aria-hidden>{c.ok ? '✅' : '⚠️'}</span><span>{c.label}{c.detail ? ` — ${c.detail}` : ''}</span></div>)}
      <div className="banner blue"><span>확정하면 ① 이 변경내역서를 잠그고 ② 변경 값으로 <b>준공내역서</b>를 새로 만듭니다 (한 줄 내역서, 단가는 값 · 금액은 TRUNC 수식). 고칠 일이 생기면 비밀번호로 잠금을 풀 수 있고, 다시 확정하면 준공내역서가 새 버전으로 만들어집니다.</span></div>
      <label className="row" style={{ gap: 8, minHeight: 44 }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 20, height: 20 }} /> 위 내용을 확인했습니다</label>
      {err && <div className="banner red">{err}</div>}
    </Modal>
  );
}

/* ---------- 잠금 해제 ---------- */
export function UnlockModal({ rev, onClose, onDone }: { rev: Rev; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await api('/api/boq/unlock', { revision_id: rev.id, password: pw, reason }); onDone(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={`잠금 해제 · ${rev.title}`} onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!pw || !reason.trim() || busy} onClick={go}>잠금 풀기</button></>}>
      <p className="sub">회사에서 정한 잠금 해제 비밀번호를 넣으세요. 누가 · 언제 · 왜 풀었는지 이력에 남습니다. {rev.kind === 'change' ? '이미 만든 준공내역서는 그대로 보관되고, 다시 확정하면 새 버전이 생깁니다.' : ''}</p>
      <div className="field"><label htmlFor="ul1">비밀번호</label><input id="ul1" className="input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></div>
      <div className="field"><label htmlFor="ul2">사유</label><input id="ul2" className="input" placeholder="예: 발주처 요청으로 받침 수량 수정" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {err && <div className="banner red">{err}</div>}
    </Modal>
  );
}

/* ---------- 잠금 비밀번호 정하기 (관리자) ---------- */
export function PasswordModal({ onClose, defaultCompany }: { onClose: () => void; defaultCompany: string }) {
  const toast = useToast();
  const { isSys, companies } = useAuth();
  const [company, setCompany] = useState(defaultCompany);
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    setErr('');
    try { await api('/api/boq/password', { company_id: company, password: pw }); toast('잠금 해제 비밀번호를 정했습니다'); onClose(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title="내역서 잠금 해제 비밀번호" onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={pw.length < 4 || pw !== pw2} onClick={go}>정하기</button></>}>
      <p className="sub">확정된 도급 · 변경내역서를 다시 고칠 때 쓰는 비밀번호입니다. 회사마다 하나이고, 새로 정하면 이전 비밀번호는 쓸 수 없습니다.</p>
      {isSys && <div className="field"><label htmlFor="pw0">회사</label><select id="pw0" className="input" value={company} onChange={(e) => setCompany(e.target.value)}>{companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
      <div className="field"><label htmlFor="pw1">새 비밀번호 (4자 이상)</label><input id="pw1" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
      <div className="field"><label htmlFor="pw2">한 번 더</label><input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {pw2 && pw !== pw2 && <span className="muted" style={{ color: 'var(--red)' }}>두 비밀번호가 다릅니다</span>}</div>
      {err && <div className="banner red">{err}</div>}
    </Modal>
  );
}

/* ---------- 변경내역서 만들기 ---------- */
export function ChangeCreate({ p, bases, onClose, onDone }: { p: any; bases: Rev[]; onClose: () => void; onDone: (id: string) => void }) {
  const rules = useLoad(() => q<any[]>(sb.from('boq_client_rules').select('*').eq('company_id', p.company_id)), [p.company_id]);
  const [baseId, setBaseId] = useState(bases[bases.length - 1]?.id);
  const [rule, setRule] = useState<Rule | null>(null);
  const [saveRule, setSaveRule] = useState(!!p.client);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const saved = (rules.data || []).find((r) => r.client === p.client);
  const R: Rule = rule || (saved ? { top: saved.top, orig_color: saved.orig_color, chg_color: saved.chg_color, merge_text: saved.merge_text } : RULE_DEFAULT);
  const set = (x: Partial<Rule>) => setRule({ ...R, ...x });
  const base = bases.find((b) => b.id === baseId);
  const go = async () => {
    setBusy(true); setErr('');
    try { const r = await api('/api/boq/change/create', { base_id: baseId, rule: R, save_rule: saveRule }); onDone(r.revision_id); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const sample = (V: 'C' | 'O') => <tr style={{ color: CSS_COLOR[V === 'C' ? R.chg_color : R.orig_color] }}><td>{V === 'C' ? '변경' : '당초'}</td><td className="r">{V === 'C' ? 20 : 16}</td><td className="r">168,213</td><td className="r">{V === 'C' ? '3,364,260' : '2,691,408'}</td></tr>;
  return (
    <Modal title="변경내역서 만들기" onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!baseId || busy} onClick={go}>{busy ? '두 줄 내역서 만드는 중…' : '만들기'}</button></>}>
      <div className="field"><label htmlFor="cb">당초 (기준 내역서)</label>
        <select id="cb" className="input" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
          {bases.map((b) => <option key={b.id} value={b.id}>{b.title} · 도급액 {won(b.totals?.contract)}</option>)}</select>
        <span className="muted">1차 변경은 도급내역서, 2차부터는 직전 준공내역서(직전 변경 값)가 당초가 됩니다.{base?.kind === 'contract' && base.status !== 'confirmed' ? ' 만들면 도급내역서는 확정 · 잠금됩니다.' : ''}</span></div>
      <h3 style={{ fontSize: 15 }}>발주처 표기 규칙 {p.client ? `· ${p.client}` : ''} {saved && !rule ? <Pill c="green">저장된 규칙</Pill> : null}</h3>
      <div className="field"><span className="muted">윗줄</span><Seg label="윗줄" value={R.top} onChange={(v) => set({ top: v })} items={[['change', '변경이 위'], ['orig', '당초가 위']]} /></div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="oc">당초 글자색</label><select id="oc" className="input" value={R.orig_color} onChange={(e) => set({ orig_color: e.target.value })}>{Object.entries(COLOR_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="cc">변경 글자색</label><select id="cc" className="input" value={R.chg_color} onChange={(e) => set({ chg_color: e.target.value })}>{Object.entries(COLOR_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <label className="row" style={{ gap: 8, minHeight: 44 }}><input type="checkbox" checked={R.merge_text} onChange={(e) => set({ merge_text: e.target.checked })} style={{ width: 20, height: 20 }} /> 품명 · 규격 · 단위를 두 줄 합쳐 한 칸으로</label>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>예시</th><th className="r">수량</th><th className="r">재료비 단가</th><th className="r">금액</th></tr></thead>
        <tbody>{(R.top === 'change' ? ['C', 'O'] : ['O', 'C']).map((v) => <Fragment key={v}>{sample(v as any)}</Fragment>)}</tbody></table></div>
      {p.client && <label className="row" style={{ gap: 8, minHeight: 44 }}><input type="checkbox" checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} style={{ width: 20, height: 20 }} /> '{p.client}' 기본 규칙으로 저장</label>}
      {err && <div className="banner red">{err}</div>}
    </Modal>
  );
}

/* ---------- 이력 ---------- */
export function BoqLogs({ pid, revId, stamp }: { pid: string; revId?: string; stamp: any }) {
  const [mine, setMine] = useState(true);
  const logs = useLoad(() => q<any[]>(sb.from('boq_logs').select('*, profiles:user_id(name, username)').eq('project_id', pid).order('created_at', { ascending: false }).limit(200)), [pid, stamp]);
  const list = (logs.data || []).filter((l) => !mine || !revId || l.revision_id === revId);
  return (
    <section className="card">
      <div className="card-h"><h2>이력</h2>
        {revId && <label className="row" style={{ gap: 6, minHeight: 44 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ width: 20, height: 20 }} /> 이 차수만</label>}</div>
      {logs.loading ? <Loading /> : logs.error ? <ErrorBox msg={logs.error} /> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>때</th><th>누가</th><th>내역서</th><th>한 일</th><th>사유 · 내용</th></tr></thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.id}>
                <td className="num">{dt(l.created_at)}</td>
                <td>{l.profiles?.name || l.profiles?.username || '-'}</td>
                <td>{l.revision_title}</td>
                <td>{/실패/.test(l.action) ? <Pill c="red">{l.action}</Pill> : /잠금 해제/.test(l.action) ? <Pill c="orange">{l.action}</Pill> : /확정/.test(l.action) ? <Pill c="blue">{l.action}</Pill> : l.action}</td>
                <td className="sub">{l.reason || ''}{l.detail?.contract != null ? ` 도급액 ${won(l.detail.contract)}` : ''}{l.detail?.final ? ` → ${l.detail.final}` : ''}{l.detail?.changed != null ? ` · 바뀐 항목 ${l.detail.changed}` : ''}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="sub">아직 이력이 없습니다.</td></tr>}
          </tbody>
        </table></div>
      )}
    </section>
  );
}
