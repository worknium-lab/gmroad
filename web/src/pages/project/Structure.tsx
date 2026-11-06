import { useState } from 'react';
import { sb, q } from '../../lib/supabase';
import { loadStructure } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { won, mul, qty } from '../../lib/format';
import { useLoad, Loading, useToast, Empty } from '../../lib/ui';

export default function Structure({ pid }: { pid: string }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const { data, loading, reload, setData } = useLoad(() => loadStructure(pid), [pid]);
  const [fac, setFac] = useState({ name: '', kind: '교량' });
  const [wk, setWk] = useState({ name: '', spec: '', unit: '개', unit_price: '' });
  if (loading || !data) return <Loading />;
  const run = async (fn: () => Promise<any>) => { try { await fn(); await reload(); } catch (e: any) { toast(e.message); } };
  const locs = data.facilities.flatMap((f) => f.locations.map((l) => ({ ...l, fac: f.name })));
  const lwMap = new Map(data.lw.map((x) => [x.location_id + '|' + x.work_item_id, x.design_qty]));
  const designTotal = data.lw.reduce((s, x) => s + mul(x.design_qty, data.works.find((w) => w.id === x.work_item_id)?.unit_price || 0), 0);

  const setQty = async (location_id: string, work_item_id: string, v: string) => {
    const key = location_id + '|' + work_item_id;
    const old = lwMap.get(key);
    if (v.trim() === '') { if (old === undefined) return; await q(sb.from('location_work').delete().eq('location_id', location_id).eq('work_item_id', work_item_id)); }
    else { const n = Number(v); if (isNaN(n) || n < 0) return toast('숫자를 넣어 주세요'); if (Number(old) === n) return; await q(sb.from('location_work').upsert({ location_id, work_item_id, design_qty: n })); }
    setData({ ...data, lw: v.trim() === '' ? data.lw.filter((x) => x.location_id + '|' + x.work_item_id !== key) : [...data.lw.filter((x) => x.location_id + '|' + x.work_item_id !== key), { location_id, work_item_id, design_qty: Number(v) }] });
  };

  return (
    <>
      <div className="banner blue"><b>구조: 공사 › 시설물 › 위치 › 공종</b><span style={{ flex: 1 }}>단일 교량은 시설물 1개로 씁니다. 아래 표에 위치별 설계수량을 넣은 칸만 현장 앱 수량 입력과 공정률에 나타납니다.</span>
        <button className="btn sm" disabled title="Claude API 연결 후">AI 구성 제안 (다음 단계)</button></div>
      <section className="card">
        <div className="card-h"><h2>시설물 · 위치</h2>
          {canEdit && <form className="row" onSubmit={(e) => { e.preventDefault(); if (!fac.name.trim()) return; run(() => q(sb.from('facilities').insert({ project_id: pid, name: fac.name.trim(), kind: fac.kind, sort: data.facilities.length }))).then(() => setFac({ ...fac, name: '' })); }}>
            <input aria-label="시설물 이름" className="input" style={{ width: 180 }} placeholder="예: 교량 1" value={fac.name} onChange={(e) => setFac({ ...fac, name: e.target.value })} />
            <select aria-label="종류" className="input" style={{ width: 110 }} value={fac.kind} onChange={(e) => setFac({ ...fac, kind: e.target.value })}>{['교량', '옹벽', '터널', '도로', '공통', '기타'].map((k) => <option key={k}>{k}</option>)}</select>
            <button className="btn pri sm">+ 시설물</button></form>}
        </div>
        {!data.facilities.length ? <Empty>시설물을 먼저 추가하세요 (예: 교량 1 · 옹벽 · 공통).</Empty> : (
          <div className="grid g3">{data.facilities.map((f) => (
            <article key={f.id} style={{ border: '1px solid var(--line-3)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row between"><div><b style={{ fontSize: 16 }}>{f.name}</b> <span className="muted">{f.kind}</span></div>
                {canEdit && <button className="link" onClick={() => confirm(`'${f.name}'과 그 위치·입력값을 모두 지울까요?`) && run(() => q(sb.from('facilities').delete().eq('id', f.id)))}>삭제</button>}</div>
              <div className="chips">{f.locations.map((l) => <span key={l.id} className="pill" style={{ fontSize: 13, padding: '6px 10px' }}>{l.name}{canEdit && <button className="link" aria-label={l.name + ' 삭제'} style={{ marginLeft: 6 }} onClick={() => confirm(`위치 '${l.name}'을 지울까요?`) && run(() => q(sb.from('locations').delete().eq('id', l.id)))}>✕</button>}</span>)}</div>
              {canEdit && <form className="row" onSubmit={(e: any) => { e.preventDefault(); const v = e.target.loc.value.trim(); if (!v) return; const names = v.split(/[,\s]+/).filter(Boolean); run(() => q(sb.from('locations').insert(names.map((n: string, i: number) => ({ facility_id: f.id, name: n, sort: f.locations.length + i }))))); e.target.reset(); }}>
                <input name="loc" aria-label="위치 추가" className="input" style={{ flex: 1, height: 38 }} placeholder="A1, P1, P2, A2 (쉼표로 여러 개)" /><button className="btn sm">+ 위치</button></form>}
            </article>))}</div>)}
      </section>

      <section className="card">
        <div className="card-h"><h2>공종 (도급단가)</h2><span className="muted">내역서 단계 전까지 직접 입력 · 공정률 금액 기준의 단가</span></div>
        {canEdit && <form className="row" onSubmit={(e) => { e.preventDefault(); if (!wk.name.trim()) return; run(() => q(sb.from('work_items').insert({ project_id: pid, name: wk.name.trim(), spec: wk.spec || null, unit: wk.unit || '식', unit_price: Math.trunc(Number(wk.unit_price.replace(/\D/g, '')) || 0), sort: data.works.length }))).then(() => setWk({ name: '', spec: '', unit: wk.unit, unit_price: '' })); }}>
          <input aria-label="공종명" className="input" style={{ width: 200 }} placeholder="공종명 (예: 받침 교체)" value={wk.name} onChange={(e) => setWk({ ...wk, name: e.target.value })} />
          <input aria-label="규격" className="input" style={{ width: 160 }} placeholder="규격" value={wk.spec} onChange={(e) => setWk({ ...wk, spec: e.target.value })} />
          <input aria-label="단위" className="input" style={{ width: 80 }} placeholder="단위" value={wk.unit} onChange={(e) => setWk({ ...wk, unit: e.target.value })} />
          <input aria-label="도급단가" className="input num" style={{ width: 150, textAlign: 'right' }} inputMode="numeric" placeholder="도급단가" value={wk.unit_price} onChange={(e) => setWk({ ...wk, unit_price: e.target.value })} />
          <button className="btn pri sm">+ 공종</button></form>}
      </section>

      <section className="card flat">
        <div className="card-h" style={{ padding: '16px 20px 0' }}><h2>위치별 설계수량</h2><span className="muted">빈칸 = 해당 없음 · 설계 금액 합계 {won(designTotal)}원</span></div>
        {!data.works.length || !locs.length ? <div style={{ padding: 20 }}><Empty>시설물 · 위치와 공종을 먼저 넣으면 표가 만들어집니다.</Empty></div> : (
          <div className="tbl-wrap" style={{ padding: '10px 0 0' }}><table className="tbl">
            <thead><tr><th>공종 · 규격</th><th>단위</th><th className="r">도급단가</th>{locs.map((l) => <th key={l.id} className="c">{l.fac}<br /><b style={{ color: 'var(--text)' }}>{l.name}</b></th>)}<th className="r">설계수량 계</th><th /></tr></thead>
            <tbody>{data.works.map((w) => { const total = locs.reduce((s, l) => s + Number(lwMap.get(l.id + '|' + w.id) || 0), 0); return (
              <tr key={w.id}><td><b>{w.name}</b><div className="muted">{w.spec}</div></td><td>{w.unit}</td>
                <td className="r">{canEdit ? <input aria-label={w.name + ' 단가'} className="input num" style={{ width: 120, height: 36, textAlign: 'right' }} defaultValue={won(w.unit_price)} onBlur={(e) => { const n = Math.trunc(Number(e.target.value.replace(/\D/g, '')) || 0); if (n !== Number(w.unit_price)) run(() => q(sb.from('work_items').update({ unit_price: n }).eq('id', w.id))); }} /> : won(w.unit_price)}</td>
                {locs.map((l) => { const v = lwMap.get(l.id + '|' + w.id); return <td key={l.id} className="c" style={{ background: v !== undefined ? 'var(--blue-ll)' : undefined }}>
                  {canEdit ? <input aria-label={`${w.name} ${l.fac} ${l.name} 설계수량`} className="input num" inputMode="decimal" style={{ width: 80, height: 36, textAlign: 'right' }} defaultValue={v ?? ''} onBlur={(e) => setQty(l.id, w.id, e.target.value).catch((er) => toast(er.message))} /> : qty(v)}</td>; })}
                <td className="r"><b>{qty(total)}</b></td>
                <td>{canEdit && <button className="link" onClick={() => confirm(`공종 '${w.name}'을 지울까요? 입력된 수량도 함께 지워집니다.`) && run(() => q(sb.from('work_items').delete().eq('id', w.id)))}>삭제</button>}</td></tr>); })}</tbody>
          </table></div>)}
      </section>
    </>
  );
}
