// ④ 내역서 › 한눈에 › 현장 앱 — 확정 내역서를 공릉천교 현장 앱 '내역' 탭(보기 전용)으로 보내기
//   보내는 것: 프로젝트(계약 · 기성 진도 · 금액 구성 · 문서) / 내역서 트리(품명 · 규격 · 수량 · 단가 · 금액) / 원가 요약
//   계산은 적산 엔진, 원가계산서 줄은 엑셀 그대로. 현장에서는 읽기만 하고, 본사가 다시 보내면 바뀜
import { useState } from 'react';
import { api, q, sb } from '../../lib/supabase';
import { dt, won } from '../../lib/format';
import { useLoad, useToast, Pill } from '../../lib/ui';
import { useAuth } from '../../lib/auth';
import { toSheet, type BoqItem } from '../../lib/boqSheet';
import { inferRates } from '../../lib/boqCost';
import { remap, roundAmounts, rowMap, total, type QtyMap } from '../../lib/boqProgress';
import { costSheet, lineAmount, type Line } from '../../lib/estimate';
import { fetchItems } from './BoqChange';

type Node = { n: string; s?: string; u?: string; q?: number; m?: number; l?: number; e?: number; t: number; c?: Node[] };
const node = (l: Line): Node => l.children
  ? { n: l.name, t: lineAmount(l).t, c: l.children.map(node) }
  : { n: l.name, s: l.spec || undefined, u: l.unit || undefined, q: l.qty, m: l.mu, l: l.lu, e: l.eu, t: lineAmount(l).t };

/** 현장 앱용 묶음 만들기 */
export async function buildAppPayload(pid: string, base: any, revs: any[]) {
  const items: BoqItem[] = await fetchItems(base.id);
  const sheet = toSheet(items);
  const whole = total(sheet);
  const contract = Number(base.totals?.contract || 0);
  const inf = inferRates(items, whole);
  const useCost = Math.abs(inf.calc.total - contract) < 1;
  const design = revs.filter((r) => r.kind === 'design').slice(-1)[0];
  const rate = revs.filter((r) => r.kind === 'contract').map((r) => r.params?.rate).filter(Boolean).slice(-1)[0] || null;

  // 기성: 확정된 마지막 회차까지
  const rounds = await q<any[]>(sb.from('boq_rounds').select('*').eq('project_id', pid).order('seq'));
  const done = rounds.filter((r) => r.status === 'confirmed');
  let progress: any = null;
  if (done.length) {
    const others = new Map<string, Map<string, string>>();
    const maps: QtyMap[] = [];
    for (const r of done) {
      if (r.revision_id === base.id) { maps.push(r.qty || {}); continue; }
      if (!others.has(r.revision_id)) others.set(r.revision_id, rowMap(await fetchItems(r.revision_id), items));
      maps.push(remap(r.qty || {}, others.get(r.revision_id)!));
    }
    const idx = maps.length - 1;
    const am = roundAmounts(sheet, maps, idx);
    const last = done[idx];
    const pay = (a: typeof am.cur) => (useCost ? costSheet({ direct: a, rates: inf.rates, exclude: inf.exclude }).total : (whole.t ? Math.trunc((contract * a.t) / whole.t) : 0));
    progress = { title: last.title, from: last.period_from, to: last.period_to, cum_rate: whole.t ? am.cum.t / whole.t : 0, cur_pay: pay(am.cur), cum_pay: pay(am.cum) };
  }

  // 원가: 엑셀 원가계산서 줄 그대로 + 비목 비율(순공사원가 대비)
  const summary = items.filter((i) => i.section === 'summary').map((i) => ({ n: i.name, a: Number(i.total_amt || 0), b: i.kind === 'cost' && /(계|액)$/.test((i.name || '').replace(/\s+/g, '')) }));
  const c = useCost ? inf.calc : null;
  const share = c ? { A: c.get('A'), B: c.get('B'), C: c.get('C'), D: c.get('D') } : { A: whole.m, B: whole.l, C: whole.e, D: whole.t };
  const t = base.totals || {};
  const bar = [['재료비', whole.m], ['노무비', whole.l], ['경비', whole.e], ['간접비 · 보험료', Number(t.net || 0) - whole.t], ['일반관리비', Number(t.overhead || 0)], ['이윤', Number(t.profit || 0)], ['부가세', Number(t.vat || 0)]]
    .filter(([, v]) => (v as number) > 0);

  // 문서 목록
  const subs = await q<any[]>(sb.from('boq_subs').select('vendor, seq, result, status').eq('project_id', pid).eq('status', 'confirmed').order('seq'));
  const docs = [
    ...revs.filter((r) => r.kind !== 'change' || r.locked).map((r) => ({ n: r.title, a: Number(r.totals?.contract || 0), k: r.kind, on: r.id === base.id })),
    ...done.map((r) => ({ n: `기성 ${r.title}`, a: null, k: 'round' })),
    ...subs.map((s) => ({ n: `하도급 · ${s.vendor}${s.seq > 1 ? ` (${s.seq - 1}차 변경)` : ''}`, a: Number(s.result?.sub || 0), k: 'sub' })),
  ];

  return {
    v: 1,
    base: { id: base.id, title: base.title, kind: base.kind, confirmed_at: base.confirmed_at },
    design_total: design ? Number(design.totals?.contract || 0) : null,
    contract_total: contract, rate,
    direct: whole, progress, summary, share, bar, docs, cost_method: useCost ? 'cost' : 'ratio',
    tree: sheet.sections[0].lines.map(node),
  };
}

export default function BoqApp({ pid, revs, base }: { pid: string; revs: any[]; base?: any }) {
  const toast = useToast();
  const { isSys, canEdit } = useAuth();
  const tg = useLoad(() => q<any>(sb.from('boq_app_targets').select('*').eq('project_id', pid).maybeSingle()), [pid]);
  const [busy, setBusy] = useState(false);
  if (tg.loading || tg.error) return null;
  const t = tg.data;
  if (!t && !isSys) return null; // 이어지지 않은 공사는 시스템 관리자에게만 보임

  const link = async () => {
    if (!window.confirm('이 공사를 공릉천교 현장 앱 ‘내역’ 탭과 이을까요? 한 앱에는 한 공사만 이을 수 있습니다.')) return;
    try { await q(sb.from('boq_app_targets').insert({ project_id: pid, app: 'gongneung', doc_id: 'current' })); tg.reload(); toast('이었습니다'); }
    catch (e: any) { toast(/duplicate|unique/.test(e.message) ? '공릉천교 현장 앱은 이미 다른 공사와 이어져 있습니다. 그 공사에서 먼저 끊으세요' : e.message); }
  };
  const unlink = async () => {
    if (!window.confirm('현장 앱과 연결을 끊을까요? 앱에 이미 보낸 내역서는 남습니다.')) return;
    try { await q(sb.from('boq_app_targets').delete().eq('project_id', pid)); tg.reload(); } catch (e: any) { toast(e.message); }
  };
  const send = async () => {
    if (!base) return;
    setBusy(true);
    try {
      const payload = await buildAppPayload(pid, base, revs);
      await api('/api/boq/publish-app', { project_id: pid, payload });
      tg.reload(); toast('현장 앱으로 보냈습니다. 앱이 동기화하면 ‘내역’ 탭에 나옵니다');
    } catch (e: any) { toast('보내지 못했습니다: ' + e.message); }
    setBusy(false);
  };
  const ready = base && (base.locked || base.status === 'confirmed');
  const stale = t?.sent_title && base && t.sent_title !== base.title;

  return (
    <section className="card">
      <div className="card-h"><h2>현장 앱</h2>{t ? <Pill c="teal">공릉천교 현장 앱과 이어짐</Pill> : <Pill>이어지지 않음</Pill>}</div>
      {!t ? <span className="sub">이 공사를 공릉천교 현장 앱과 이으면, 확정한 내역서를 앱의 ‘내역’ 탭(프로젝트 · 내역서 · 원가, 보기 전용)으로 보낼 수 있습니다.</span> : <>
        <span className="sub">현장에서는 시공 전 규격 · 수량 확인, 자재 반입 대조, 계약금액 · 진도 확인에 씁니다. 앱에서는 고칠 수 없고, 여기서 다시 보내면 바뀝니다.</span>
        <div className="row between">
          <span className="muted">{t.sent_at ? `마지막으로 보냄: ${t.sent_title} · ${dt(t.sent_at)}` : '아직 보낸 적이 없습니다'}</span>
          <div className="row">
            {canEdit && <button className="btn pri" disabled={busy || !ready} title={ready ? undefined : '도급내역서를 확정한 뒤 보낼 수 있습니다'} onClick={send}>{busy ? '보내는 중…' : `‘${base?.title || '내역서'}’ 보내기`}</button>}
            {isSys && <button className="btn sm" onClick={unlink}>연결 끊기</button>}
          </div>
        </div>
        {stale && <div className="banner">앱에 있는 것은 ‘{t.sent_title}’입니다. 지금 기준은 ‘{base.title}’이니 다시 보내 주세요.</div>}
        {!ready && <span className="muted">확정된 도급 · 준공내역서만 보낼 수 있습니다.</span>}
        <span className="muted">기성 진도는 확정된 회차까지 들어갑니다. 기성을 확정한 뒤에도 다시 보내 주세요. 금액: {won(base?.totals?.contract)}원 기준.</span>
      </>}
      {!t && isSys && <div className="row"><button className="btn" onClick={link}>공릉천교 현장 앱과 잇기</button></div>}
    </section>
  );
}
