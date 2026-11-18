// ④ 내역서 › 일위대가 · 단가 — 단가가 어디서 나왔는지 따라가 보기 (기준 엑셀의 호표 · 목록 · 노임 · 자재)
//   목적: 내역 단가의 근거(호표 → 노임 · 자재)를 보여 주고, 호표 합계를 적산 규칙으로 검산
import { useMemo, useState, type ReactNode } from 'react';
import { won, qty as fq } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Pill, Seg } from '../../lib/ui';
import { api } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { buildLinks, checkBlocks, blockKey, refKey, sum3, type RBlock, type RRef, type Refs } from '../../lib/boqBasis';
import { fetchItems } from './BoqChange';
import { useRefs } from './BoqUnitCost';

type Tab = 'block' | 'triple' | 'labor' | 'material';
const nz = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const pctS = (v: number) => (v * 100).toFixed(3) + '%';
/** 호표 줄 금액: 소수 첫째 자리까지 (호표 양식 관례) */
const w1 = (v: number) => (v ? v.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '0');

export default function BoqBasis({ rev, rate, onFind, onCreated }: { rev: any; rate?: number; onFind: (name: string) => void; onCreated: (id: string) => void }) {
  const refs = useRefs(rev.id);
  const { canEdit } = useAuth();
  const items = useLoad(() => fetchItems(rev.id), [rev.id]);
  const [tab, setTab] = useState<Tab>('block');
  const [f, setF] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const data: Refs | undefined = refs.data;
  const links = useMemo(() => (data && items.data ? buildLinks(data, items.data) : null), [data, items.data]);
  const checks = useMemo(() => (data ? checkBlocks(data.blocks) : null), [data]);

  if (refs.loading || items.loading) return <Loading />;
  if (refs.error) return <ErrorBox msg={refs.error} />;
  if (items.error) return <ErrorBox msg={items.error} />;
  if (!data || !links || !checks) return null;

  const blocks = data.blocks;
  const kinds = (k: Tab) => data.prices.filter((p) => (k === 'material' ? p.kind === 'material' || p.kind === 'price' : p.kind === k));
  const leafCount = (items.data || []).filter((i: any) => i.section === 'detail' && (i.kind === 'item' || i.kind === 'link')).length;
  const traced = links.itemRef.size;
  const diffBlocks = blocks.filter((b) => checks.get(blockKey(b)) && !checks.get(blockKey(b))!.same);
  const r = rev.kind === 'design' ? undefined : rev.params?.rate || rate;
  const m = (s: string) => !f || nz(s).includes(nz(f));
  const pickBlock = (b: RBlock) => { setTab('block'); setSel(blockKey(b)); setF(''); };

  if (!blocks.length && !data.prices.length) {
    return <section className="card"><h2>일위대가 · 단가</h2><span className="sub">기준 엑셀에서 일위대가 · 단가 시트를 찾지 못했습니다. 내역서 시트만 있는 엑셀이면 단가 근거를 따라갈 수 없습니다.</span></section>;
  }

  return (
    <>
      <div className="grid g4">
        <div className="stat"><span className="l">일위대가 호표</span><span className="v">{blocks.length.toLocaleString()}</span><span className="s">{diffBlocks.length ? `검산 차이 ${diffBlocks.length}개` : '검산 모두 같음'}</span></div>
        <div className="stat"><span className="l">단가 목록</span><span className="v">{kinds('triple').length.toLocaleString()}</span><span className="s">일위대가 · 중기 · 경비 목록</span></div>
        <div className="stat"><span className="l">노임 · 자재</span><span className="v">{(kinds('labor').length + kinds('material').length).toLocaleString()}</span><span className="s">노임 {kinds('labor').length} · 자재 {kinds('material').length}</span></div>
        <div className="stat"><span className="l">근거를 찾은 내역 항목</span><span className="v">{leafCount ? Math.round((traced / leafCount) * 100) : 0}%</span><span className="s">{traced.toLocaleString()} / {leafCount.toLocaleString()}줄</span></div>
      </div>
      {r ? <div className="banner blue">기준 설계내역서 엑셀의 단가입니다. 이 {rev.kind === 'contract' ? '도급' : rev.kind === 'change' ? '변경' : '준공'}내역서 단가는 여기에 낙찰률 {pctS(r)}를 곱하고 원 미만을 버린 값입니다.</div> : null}

      <div className="row between">
        <Seg label="자료" value={tab} onChange={(v) => { setTab(v); setF(''); setOpen(null); }}
          items={[['block', `일위대가 호표 (${blocks.length})`], ['triple', `단가 목록 (${kinds('triple').length})`], ['labor', `노임 (${kinds('labor').length})`], ['material', `자재 (${kinds('material').length})`]]} />
        <input className="input" style={{ width: 220 }} placeholder={tab === 'block' ? '호표 찾기 (예: 무수축, No.3)' : '명칭 · 규격 찾기'} value={f} onChange={(e) => setF(e.target.value)} aria-label="찾기" />
      </div>

      {tab === 'labor' && (rev.kind === 'design'
        ? (canEdit && <WagePanel rev={rev} labor={kinds('labor')} onCreated={onCreated} />)
        : <div className="muted">노임 일괄 갱신은 설계내역서에서 합니다 (도급 계약 뒤에는 단가가 고정됩니다). 위 차수 단추에서 설계내역서를 고르세요.</div>)}
      {tab === 'block' ? (
        <BlockTab blocks={blocks.filter((b) => m(b.code + b.name + (b.spec || '')))} all={blocks} sel={sel} setSel={setSel} links={links} checks={checks} onFind={onFind} />
      ) : (
        <section className="card flat">
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>시트</th><th>명칭</th><th>규격</th><th className="c">단위</th>
              {tab === 'triple' ? <><th className="r">재료비</th><th className="r">노무비</th><th className="r">경비</th></> : <th className="r">단가</th>}
              <th className="r">쓰는 호표</th>{tab === 'triple' && <th className="r">내역 항목</th>}</tr></thead>
            <tbody>
              {kinds(tab).filter((p) => m(p.name + (p.spec || '') + p.sheet)).slice(0, 400).map((p: RRef) => {
                const k = refKey(p);
                const used = links.usedBy.get(k) || [];
                const uses = links.refUses.get(k) || [];
                const blk = tab === 'triple' ? links.blockFor(p.name, p.spec) : undefined;
                return (
                  <FragmentRow key={k} open={open === k} cols={tab === 'triple' ? 9 : 6}
                    onClick={() => (blk ? pickBlock(blk) : setOpen(open === k ? null : k))}
                    cells={<>
                      <td className="muted">{p.sheet} {p.row}행</td><td><b>{p.name}</b></td><td className="sub">{p.spec}</td><td className="c">{p.unit}</td>
                      {tab === 'triple' ? <><td className="r">{won(p.mat?.v)}</td><td className="r">{won(p.lab?.v)}</td><td className="r">{won(p.exp?.v)}</td></> : <td className="r">{won(p.price?.v)}</td>}
                      <td className="r">{used.length ? used.length + '개' : blk ? <span className="link">호표 보기 ›</span> : <span className="muted">-</span>}</td>
                      {tab === 'triple' && <td className="r">{uses.length ? uses.length + '줄' : <span className="muted">-</span>}</td>}
                    </>}
                    detail={used.length ? <div className="row">{used.map((b) => <button key={blockKey(b)} className="btn sm" onClick={() => pickBlock(b)}>{b.code ? b.code + ' ' : ''}{b.name}</button>)}</div>
                      : <span className="muted">이 단가를 쓰는 호표가 없습니다.</span>} />
                );
              })}
              {!kinds(tab).length && <tr><td colSpan={9} className="sub">기준 엑셀에서 이 자료 시트를 찾지 못했습니다.</td></tr>}
            </tbody>
          </table></div>
          <div className="muted" style={{ padding: '8px 14px' }}>{tab === 'triple' ? '줄을 누르면 같은 이름의 호표로 갑니다.' : '줄을 누르면 이 단가를 쓰는 호표가 나옵니다.'} 앞 400줄까지 보입니다.</div>
        </section>
      )}
    </>
  );
}

function FragmentRow({ open, cols, onClick, cells, detail }: { open: boolean; cols: number; onClick: () => void; cells: ReactNode; detail: ReactNode }) {
  return (
    <>
      <tr className="click" onClick={onClick} aria-expanded={open}>{cells}</tr>
      {open && <tr><td colSpan={cols} style={{ background: 'var(--blue-ll)' }}>{detail}</td></tr>}
    </>
  );
}

/* ---------- 호표: 왼쪽 목록 · 오른쪽 산출 내용 ---------- */
function BlockTab({ blocks, all, sel, setSel, links, checks, onFind }: {
  blocks: RBlock[]; all: RBlock[]; sel: string | null; setSel: (k: string) => void;
  links: ReturnType<typeof buildLinks>; checks: ReturnType<typeof checkBlocks>; onFind: (name: string) => void;
}) {
  const cur = all.find((b) => blockKey(b) === sel) || blocks[0];
  const key = cur ? blockKey(cur) : '';
  const ck = checks.get(key);
  const lr = links.lineRefs.get(key) || [];
  const uses = links.blockUses.get(key) || [];
  return (
    <div className="grid boq-side">
      <section className="card flat">
        <div className="boq-list" role="listbox" aria-label="호표 목록">
          {blocks.map((b) => {
            const k = blockKey(b); const c = checks.get(k); const u = links.blockUses.get(k)?.length || 0;
            return (
              <button key={k} type="button" role="option" aria-selected={k === key} className={k === key ? 'on' : ''} onClick={() => setSel(k)}>
                <span className="t"><b>{b.code ? <span className="muted">{b.code} </span> : null}{b.name}</b>{b.spec && <small>{b.spec}</small>}</span>
                <span className="v"><span className="num">{won(b.mat + b.lab + b.exp)}</span><small>{u ? `내역 ${u}곳` : ''}{c && !c.same ? <i className="dot" title="검산 차이" /> : null}</small></span>
              </button>
            );
          })}
          {!blocks.length && <div className="sub" style={{ padding: 14 }}>찾는 호표가 없습니다.</div>}
        </div>
      </section>

      {cur && <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <section className="card flat">
          <div className="card-h" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <h2>{cur.code ? cur.code + ' · ' : ''}{cur.name}</h2>
              <span className="muted">{[cur.spec, cur.unit && cur.unit + '당', `${cur.sheet} ${cur.row}행`].filter(Boolean).join(' · ')}</span>
            </div>
            {ck && (ck.same ? <Pill c="green">검산 같음</Pill> : <Pill c="orange">검산 {won(sum3(ck.total) - sum3(ck.excel))}원 차이</Pill>)}
          </div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>품명</th><th>규격</th><th className="c">단위</th><th className="r">수량</th><th className="r">재료비</th><th className="r">노무비</th><th className="r">경비</th><th>단가 출처</th></tr></thead>
            <tbody>{cur.lines.map((ln, i) => {
              const a = ck?.lines[i];
              const src = lr[i] || [];
              return (
                <tr key={i}>
                  <td>{ln.name}</td><td className="sub">{ln.spec}</td><td className="c">{ln.unit}</td><td className="r">{fq(ln.qty)}</td>
                  <td className="r">{a ? w1(a.m) : ''}</td><td className="r">{a ? w1(a.l) : ''}</td><td className="r">{a ? w1(a.e) : ''}</td>
                  <td className="muted">{src.length ? src.map((s) => `${s.sheet} · ${s.name}`).join(', ') : ln.src?.includes('금액') ? '금액 직접' : ''}</td>
                </tr>
              );
            })}</tbody>
            {ck && <tfoot>
              <tr><td>계 (다시 계산)</td><td></td><td></td><td></td><td className="r">{won(ck.total.m)}</td><td className="r">{won(ck.total.l)}</td><td className="r">{won(ck.total.e)}</td><td className="r">{won(sum3(ck.total))}</td></tr>
              {!ck.same && <tr style={{ fontWeight: 400, color: 'var(--sub)' }}><td>엑셀 값</td><td></td><td></td><td></td><td className="r">{won(ck.excel.m)}</td><td className="r">{won(ck.excel.l)}</td><td className="r">{won(ck.excel.e)}</td><td className="r">{won(sum3(ck.excel))}</td></tr>}
            </tfoot>}
          </table></div>
          <div className="muted" style={{ padding: '8px 16px 12px' }}>다시 계산: 줄마다 수량 × 단가를 소수 첫째 자리까지 버리고, 합계는 원 미만을 버립니다 (적산 엔진 규칙).{ck && !ck.same ? ' 엑셀이 다른 자리에서 반올림 · 버림했을 수 있습니다.' : ''}</div>
        </section>

        <section className="card">
          <div className="card-h"><h3>이 호표를 쓰는 내역 항목</h3><span className="muted">{uses.length}줄</span></div>
          {uses.length === 0 ? <span className="sub">내역서에서 이 호표를 가리키는 항목을 찾지 못했습니다. (단가 수식이 일위대가목록을 거치지 않거나, 이름이 다를 수 있습니다)</span> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>행</th><th>공종명</th><th>규격</th><th className="r">수량</th><th className="r">합계 단가</th><th className="r">금액</th><th></th></tr></thead>
              <tbody>{uses.map((it: any) => (
                <tr key={it.row}>
                  <td className="muted num">{it.row}</td><td>{it.name}</td><td className="sub">{it.spec}</td><td className="r">{fq(it.qty)}</td>
                  <td className="r">{won(Number(it.mat_price || 0) + Number(it.lab_price || 0) + Number(it.exp_price || 0))}</td><td className="r">{won(it.total_amt)}</td>
                  <td><button className="btn sm" onClick={() => onFind(it.name)}>내역서에서 보기</button></td>
                </tr>))}</tbody>
            </table></div>)}
        </section>
      </div>}
    </div>
  );
}

/* ---------- 노임 일괄 갱신 (설계내역서만) ----------
   새 시중노임을 넣거나(직종명 · 단가 줄을 붙여넣기) → 미리 계산 → 새 설계내역서로 저장 (원본 엑셀은 그대로) */
export function WagePanel({ rev, labor, onCreated }: { rev: any; labor: RRef[]; onCreated: (id: string) => void }) {
  const toast = useToast();
  const now = new Date();
  const [label, setLabel] = useState(`${now.getFullYear()}년 ${now.getMonth() >= 6 ? '하반기' : '상반기'} 노임`);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState('');
  const [pv, setPv] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const rows = labor.filter((p) => p.price?.f);
  const changed = rows.filter((p) => vals[p.price!.f!] && Number(vals[p.price!.f!]) !== Number(p.price!.v));
  const body = (dry: boolean) => ({ revision_id: rev.id, label, dry_run: dry, wages: changed.map((p) => ({ f: p.price!.f, v: Number(vals[p.price!.f!]) })) });

  const applyPaste = () => {
    // 줄마다: [직종번호] 직종명 … 단가 (탭 · 쉼표 · 공백 2칸 이상으로 나뉨, 마지막 숫자가 단가)
    const byName = new Map(rows.map((p) => [nz(p.name), p]));
    const n = { ...vals }; let hit = 0, miss = 0;
    for (const line of paste.split(/\r?\n/)) {
      const t = line.trim(); if (!t) continue;
      const nums = t.match(/[\d,]+(?:\.\d+)?/g) || [];
      const price = Number((nums[nums.length - 1] || '').replace(/,/g, ''));
      const name = t.replace(/^\s*\d+\s*/, '').split(/\t|,|\s{2,}/)[0].replace(/[\d,]+$/, '').trim();
      const p = byName.get(nz(name));
      if (p && price > 0) { n[p.price!.f!] = String(Math.trunc(price)); hit++; } else miss++;
    }
    setVals(n); setPv(null);
    toast(`${hit}개 직종에 넣었습니다${miss ? ` · 이름이 맞지 않은 줄 ${miss}개` : ''}`);
  };
  const preview = async () => {
    setBusy(true);
    try { setPv((await api('/api/boq/wage-update', body(true))).result); } catch (e: any) { toast(e.message); }
    setBusy(false);
  };
  const save = async () => {
    if (!window.confirm(`새 노임 ${changed.length}개로 '설계내역서 (${label})'를 만들까요? 원래 설계내역서는 그대로 남습니다.`)) return;
    setBusy(true);
    try { const r = await api('/api/boq/wage-update', body(false)); toast('새 설계내역서를 만들었습니다'); onCreated(r.revision_id); } catch (e: any) { toast(e.message); }
    setBusy(false);
  };
  const diff = pv && pv.after.contract != null && pv.before.contract != null ? pv.after.contract - pv.before.contract : null;

  return (
    <section className="card">
      <div className="card-h"><h2>새 노임으로 다시 계산</h2><span className="muted">설계내역서 → 새 버전 (원본 그대로)</span></div>
      <span className="sub">새 시중노임단가가 나오면 노임 칸만 바꾸고, 호표 → 내역 → 원가계산서는 엑셀 수식대로 다시 계산해 새 설계내역서를 만듭니다. 도급 계약 뒤 단가는 바뀌지 않습니다 (물가변동은 따로).</span>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="field"><label htmlFor="wpaste">협회 노임단가 붙여넣기 (선택)</label>
          <textarea id="wpaste" className="input" rows={4} placeholder={'직종명과 단가를 한 줄에 하나씩\n예) 1034  도장공  260,000\n    특별인부\t245000'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div className="row"><button className="btn sm" disabled={!paste.trim()} onClick={applyPaste}>이름이 같은 직종에 넣기</button><span className="muted">아래 표에 바로 넣어도 됩니다</span></div></div>
        <div className="field"><label htmlFor="wlabel">새 버전 이름</label>
          <input id="wlabel" className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
          <span className="muted">설계내역서 ({label})로 저장됩니다.</span></div>
      </div>
      <div className="tbl-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="tbl">
        <thead><tr><th>시트</th><th>직종</th><th className="c">단위</th><th className="r">지금 단가</th><th className="r">새 단가</th><th className="r">차이</th></tr></thead>
        <tbody>{rows.map((p) => {
          const k = p.price!.f!; const v = vals[k]; const d = v ? Number(v) - Number(p.price!.v || 0) : 0;
          return (
            <tr key={k} style={v && d ? { background: '#FFFCF6' } : undefined}>
              <td className="muted">{p.sheet} {p.row}행</td><td><b>{p.name}</b>{p.spec ? <span className="muted"> · {p.spec}</span> : null}</td><td className="c">{p.unit}</td>
              <td className="r">{won(p.price!.v)}</td>
              <td className="r"><input className="qin" style={{ width: 110 }} inputMode="numeric" aria-label={`${p.name} 새 단가`} value={v || ''} onChange={(e) => { setVals({ ...vals, [k]: e.target.value.replace(/[^\d]/g, '') }); setPv(null); }} /></td>
              <td className="r" style={{ color: d > 0 ? 'var(--teal)' : d < 0 ? 'var(--red)' : 'var(--sub)' }}>{v && d ? (d > 0 ? '+' : '') + won(d) : ''}</td>
            </tr>);
        })}</tbody>
      </table></div>
      {pv && <div className={'banner ' + (pv.changed.length ? 'blue' : '')}>
        <span style={{ flex: 1 }}>노임 {pv.changed.length}개 바뀜 · 내역 항목 {pv.items}줄 금액 바뀜 · 도급(예정)액 {won(pv.before.contract)} → <b>{won(pv.after.contract)}</b>{diff != null ? ` (${diff >= 0 ? '+' : ''}${won(diff)})` : ''}
          {pv.skipped.length ? ` · 바꾸지 않음 ${pv.skipped.length}개 (${[...new Set(pv.skipped.map((s: any) => s.why))].join(', ')})` : ''}</span></div>}
      <div className="row">
        <span className="muted">{changed.length ? `새 단가 ${changed.length}개` : '바꿀 단가를 넣으세요'}</span>
        <button className="btn" disabled={busy || !changed.length} onClick={preview}>{busy && !pv ? '계산 중…' : '미리 계산'}</button>
        <button className="btn pri" disabled={busy || !pv || !pv.changed.length} onClick={save}>{busy && pv ? '만드는 중…' : '새 설계내역서로 저장'}</button>
      </div>
    </section>
  );
}
