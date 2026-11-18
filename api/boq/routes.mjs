// ④ 내역서 API
import { admin } from '../lib.mjs';
import { readWorkbook } from './xlsx.mjs';
import { Evaluator } from './evaluator.mjs';
import { findBoqSheets, parseBoq } from './detect.mjs';
import { buildContract } from './contract.mjs';
import { buildChange } from './change.mjs';
import { collectRefs } from './refs.mjs';
import { buildSheetXlsx, checkDoc } from './sheetXlsx.mjs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const BUCKET = 'project-files';
const cache = new Map(); // storage_path → Buffer (최근 4개)
async function fileBuf(path) {
  if (cache.has(path)) return cache.get(path);
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw [400, '엑셀 파일을 받을 수 없습니다: ' + (error?.message || path)];
  const buf = Buffer.from(await data.arrayBuffer());
  cache.set(path, buf); if (cache.size > 4) cache.delete(cache.keys().next().value);
  return buf;
}

async function canBoq(me, projectId) {
  const { data: p } = await admin.from('projects').select('id, company_id, name, client').eq('id', projectId).single();
  if (!p) throw [404, '프로젝트가 없습니다'];
  if (me.role === 'system_admin' || (me.role === 'company_admin' && me.company_id === p.company_id)) return p;
  if (me.role === 'staff') {
    const { data: m } = await admin.from('project_members').select('can_boq').eq('project_id', projectId).eq('user_id', me.id).maybeSingle();
    if (m?.can_boq) return p;
  }
  throw [403, '이 프로젝트의 내역서 권한이 없습니다 (① 개요 › 참여자 · 권한에서 내역서·금액 체크)'];
}

function verify(model, ev, sheet, cm, items) {
  // 프로그램 계산값 ↔ 엑셀 저장값 대조 (금액 열 전부)
  let checked = 0; const diffs = [];
  for (const it of items) for (const k of ['matAmt', 'labAmt', 'expAmt', 'totalAmt']) {
    const a = cm[k] + it.row; const c = model.sheet(sheet).cells.get(a);
    if (!c || !c.f || typeof c.v !== 'number') continue;
    checked++; const v = ev.num(sheet, a);
    if (Math.abs(v - c.v) > 0.5) diffs.push({ cell: a, excel: c.v, calc: v });
  }
  return { checked, diffCount: diffs.length, diffs: diffs.slice(0, 20) };
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function putFile(path, buf, upsert = false) {
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: XLSX, upsert });
  if (error) throw [400, '파일 저장 실패: ' + error.message];
  cache.set(path, buf);
}
async function log(rev, me, action, reason = null, detail = {}) {
  await admin.from('boq_logs').insert({ project_id: rev.project_id, revision_id: rev.id, revision_title: rev.title, action, reason, detail, user_id: me.id });
}
const itemRows = (revId, items) => items.map((it) => ({
    revision_id: revId, row: it.row, parent_row: it.parent_row ?? null, level: it.level, kind: it.kind, section: it.section,
    name: it.name, spec: it.spec || null, unit: it.unit || null, qty: it.qty, mat_price: it.mat_price, lab_price: it.lab_price, exp_price: it.exp_price,
    mat_amt: Math.trunc(it.mat_amt || 0), lab_amt: Math.trunc(it.lab_amt || 0), exp_amt: Math.trunc(it.exp_amt || 0), total_amt: Math.trunc(it.total_amt || 0),
    note: it.note || null, price_ref: it.price_ref || null,
    orig: it.orig || null, change: it.change || null, xl_row: it.xl_row ?? null, new_id: it.new_id || null,
  }));
async function insertItems(revId, items) {
  const rows = itemRows(revId, items);
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await admin.from('boq_items').insert(rows.slice(i, i + 500));
    if (e) throw [400, e.message];
  }
}
async function saveRevision(row, items) {
  const { data: rev, error } = await admin.from('boq_revisions').insert(row).select().single();
  if (error) throw [400, error.message];
  const rows = itemRows(rev.id, items);
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await admin.from('boq_items').insert(rows.slice(i, i + 500));
    if (e) { await admin.from('boq_revisions').delete().eq('id', rev.id); throw [400, e.message]; }
  }
  return rev;
}
/* ---------- 설계변경 확정 → 차수 · 기성 · 공종 연결을 새 준공내역서로 ----------
   행 번호는 공종명 · 규격 · 단위가 같은 항목끼리 짝지음 (같은 열쇠가 둘 이상이면 옮기지 않음) */
const leafKey = (i) => [i.name, i.spec, i.unit].map((x) => String(x ?? '').replace(/\s+/g, '')).join('|');
const isLeaf = (i) => i.section === 'detail' && (i.kind === 'item' || i.kind === 'link');
async function itemsOf(revId) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('boq_items').select('row, name, spec, unit, kind, section').eq('revision_id', revId).order('row').range(from, from + 999);
    if (error) throw [400, error.message];
    out.push(...data); if (data.length < 1000) break;
  }
  return out;
}
function rowMapOf(fromItems, toItems) {
  const dest = new Map();
  for (const i of toItems.filter(isLeaf)) { const k = leafKey(i); dest.set(k, dest.has(k) ? null : String(i.row)); }
  const out = new Map();
  for (const i of fromItems.filter(isLeaf)) { const d = dest.get(leafKey(i)); if (d) out.set(String(i.row), d); }
  return out;
}
const remapQty = (m, map) => { const o = {}; for (const [k, v] of Object.entries(m || {})) { const d = map.get(k); if (d) o[d] = (o[d] || 0) + Number(v); } return o; };
async function carryOver(projectId, finId, finItems) {
  const res = { rounds: 0, phases: 0, links: 0 };
  // 직전 기준: 이번 것 말고 마지막 준공내역서, 없으면 마지막 도급내역서
  const { data: prevF } = await admin.from('boq_revisions').select('id').eq('project_id', projectId).eq('kind', 'final').neq('id', finId).order('seq', { ascending: false }).limit(1);
  const { data: prevC } = await admin.from('boq_revisions').select('id').eq('project_id', projectId).eq('kind', 'contract').order('created_at', { ascending: false }).limit(1);
  const prevId = prevF?.[0]?.id || prevC?.[0]?.id;
  const maps = new Map();
  const mapFor = async (revId) => { if (!maps.has(revId)) maps.set(revId, rowMapOf(await itemsOf(revId), finItems)); return maps.get(revId); };
  // 작성 중 기성 회차 (확정된 회차는 그대로 기록으로 둠)
  const { data: rounds } = await admin.from('boq_rounds').select('id, revision_id, qty').eq('project_id', projectId).eq('status', 'draft').neq('revision_id', finId);
  for (const r of rounds || []) {
    const { error } = await admin.from('boq_rounds').update({ revision_id: finId, qty: remapQty(r.qty, await mapFor(r.revision_id)) }).eq('id', r.id);
    if (!error) res.rounds++;
  }
  if (!prevId) return res;
  // 차수: 직전 기준의 배분을 새 기준으로 복사 (신규 항목은 미배정으로 남음)
  const { data: phases } = await admin.from('boq_phases').select('seq, name, alloc').eq('revision_id', prevId).order('seq');
  if (phases?.length) {
    const map = await mapFor(prevId);
    const { error } = await admin.from('boq_phases').insert(phases.map((p) => ({ project_id: projectId, revision_id: finId, seq: p.seq, name: p.name, alloc: remapQty(p.alloc, map) })));
    if (!error) res.phases = phases.length;
  }
  // ⑦ 공정률 공종 ↔ 내역 항목 연결
  const { data: links } = await admin.from('boq_work_links').select('work_item_id, boq_row').eq('revision_id', prevId);
  for (const l of links || []) {
    const d = (await mapFor(prevId)).get(String(l.boq_row));
    const q = d ? admin.from('boq_work_links').update({ revision_id: finId, boq_row: Number(d) }) : admin.from('boq_work_links').delete();
    const { error } = await q.eq('work_item_id', l.work_item_id);
    if (!error) res.links++;
  }
  return res;
}

async function unitData(rev) {
  const { data: ucs } = await admin.from('boq_unit_costs').select('*').eq('revision_id', rev.id);
  const { data: qs } = await admin.from('boq_quotes').select('*').eq('revision_id', rev.id);
  const { data: cts } = await admin.from('boq_revisions').select('params, created_at').eq('project_id', rev.project_id).eq('kind', 'contract');
  const ct = (cts || []).filter((c) => c.params?.rate).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const bySeq = (a, b) => a.seq - b.seq;
  return { unitCosts: (ucs || []).sort(bySeq), quotes: (qs || []).sort(bySeq), rate: ct?.params?.rate || null };
}
const refsCache = new Map();
const totalsOf = (t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v).map(([k, v]) => [k, v.amount]));

export const boqRoutes = {
  // 올린 엑셀에서 내역서 시트 후보 찾기
  'POST /api/boq/inspect': async (me, b) => {
    await canBoq(me, b.project_id);
    const { data: doc } = await admin.from('documents').select('*').eq('id', b.document_id).eq('project_id', b.project_id).single();
    if (!doc) throw [404, '문서가 없습니다'];
    const model = await readWorkbook(await fileBuf(doc.storage_path));
    return { sheets: findBoqSheets(model), all: model.sheets.map((s) => s.name) };
  },

  // 설계내역서 가져오기
  'POST /api/boq/import': async (me, b) => {
    await canBoq(me, b.project_id);
    const { data: doc } = await admin.from('documents').select('*').eq('id', b.document_id).eq('project_id', b.project_id).single();
    if (!doc) throw [404, '문서가 없습니다'];
    if (!/\.xls[xm]$/i.test(doc.file_name)) throw [400, '엑셀(xlsx) 파일만 가져올 수 있습니다. xls는 엑셀에서 xlsx로 저장해 다시 올려 주세요'];
    const buf = await fileBuf(doc.storage_path);
    const model = await readWorkbook(buf);
    const cands = findBoqSheets(model);
    const pick = b.sheet ? cands.find((c) => c.sheet === b.sheet) : cands[0];
    if (!pick) throw [400, '내역서 시트를 찾지 못했습니다 (머리글: 공종명 · 수량 · 단위 · 재료비 · 노무비 · 경비)'];
    const ev = new Evaluator(model);
    const parsed = parseBoq(model, ev, pick.sheet, pick.headerRow);
    const check = verify(model, ev, pick.sheet, parsed.cm, parsed.items);
    // 원본 문서가 지워져도 내역서는 남도록 복사본을 둠
    const path = `${b.project_id}/boq/${Date.now()}_design.xlsx`;
    await putFile(path, buf);
    const { count } = await admin.from('boq_revisions').select('id', { count: 'exact', head: true }).eq('project_id', b.project_id).eq('kind', 'design');
    const rev = await saveRevision({
      project_id: b.project_id, kind: 'design', seq: (count || 0) + 1, title: '설계내역서' + (count ? ` (${count + 1})` : ''),
      source_document_id: doc.id, storage_path: path, file_name: doc.file_name, sheet_name: pick.sheet, header_row: pick.headerRow,
      col_map: parsed.cm, totals: totalsOf(parsed.totals), check_result: check, created_by: me.id, status: 'confirmed', locked: true,
    }, parsed.items);
    await log(rev, me, '설계내역서 가져오기', null, { file: doc.file_name, check });
    return { revision_id: rev.id, sheet: pick.sheet, items: parsed.items.length, totals: rev.totals, check };
  },

  // 도급내역서 만들기 (dry_run이면 계산 결과만)
  'POST /api/boq/contract': async (me, b) => {
    const { data: base } = await admin.from('boq_revisions').select('*').eq('id', b.revision_id).single();
    if (!base) throw [404, '설계내역서가 없습니다'];
    await canBoq(me, base.project_id);
    const rate = Number(b.rate);
    const target = b.target ? Math.trunc(Number(b.target)) : null;
    const r = await buildContract(await fileBuf(base.storage_path), {
      sheet: base.sheet_name, headerRow: base.header_row, rate, target,
      fixedRows: (b.fixed_rows || []).map(Number), noRateRows: (b.no_rate_rows || []).map(Number),
    });
    if (b.dry_run) return { result: r.result, totals: totalsOf(r.after.totals) };
    const out = await r.makeFile();
    const name = base.file_name.replace(/\.xlsx?$/i, '') + `_도급내역서_${(rate * 100).toFixed(3)}%.xlsx`;
    const path = `${base.project_id}/boq/${Date.now()}_contract.xlsx`;
    await putFile(path, out);
    const { count } = await admin.from('boq_revisions').select('id', { count: 'exact', head: true }).eq('project_id', base.project_id).eq('kind', 'contract');
    const rev = await saveRevision({
      project_id: base.project_id, kind: 'contract', seq: (count || 0) + 1, title: '도급내역서' + (count ? ` (${count + 1})` : ''), base_id: base.id,
      storage_path: path, file_name: name, sheet_name: base.sheet_name, header_row: base.header_row, col_map: r.after.cm,
      totals: totalsOf(r.after.totals), params: { rate, target, fixed_rows: b.fixed_rows || [], no_rate_rows: b.no_rate_rows || [], result: r.result },
      created_by: me.id,
    }, r.after.items);
    await log(rev, me, '도급내역서 생성', null, { rate, contract: r.result.reached ?? r.result.afterRate, profitRate: r.result.profitRate });
    return { revision_id: rev.id, result: r.result };
  },

  // 차수 지우기 (확정 전만)
  'POST /api/boq/delete': async (me, b) => {
    const { data: rev } = await admin.from('boq_revisions').select('*').eq('id', b.revision_id).single();
    if (!rev) throw [404, '없습니다'];
    await canBoq(me, rev.project_id);
    if (rev.kind !== 'design' && (rev.status === 'confirmed' || rev.locked)) throw [400, '확정된 내역서는 지울 수 없습니다. 먼저 잠금을 풀어 주세요'];
    const { count } = await admin.from('boq_revisions').select('id', { count: 'exact', head: true }).eq('base_id', rev.id);
    if (count) throw [400, '이 내역서로 만든 다음 차수가 있어 지울 수 없습니다'];
    const { count: rounds } = await admin.from('boq_rounds').select('id', { count: 'exact', head: true }).eq('revision_id', rev.id);
    if (rounds) throw [400, `이 내역서를 기준으로 한 기성 회차가 ${rounds}개 있어 지울 수 없습니다 (④ 내역서 › 기성)`];
    const { count: subs } = await admin.from('boq_subs').select('id', { count: 'exact', head: true }).eq('revision_id', rev.id);
    if (subs) throw [400, `이 내역서를 기준으로 한 하도급내역서가 ${subs}개 있어 지울 수 없습니다 (④ 내역서 › 하도급)`];
    // DB 줄을 먼저 지우고, 성공했을 때만 엑셀 파일을 지움 (실패하면 파일이 남아 있어야 함)
    const { error: delErr } = await admin.from('boq_revisions').delete().eq('id', rev.id);
    if (delErr) throw [400, '지우지 못했습니다: ' + delErr.message];
    await admin.storage.from(BUCKET).remove([rev.storage_path]);
    await log({ ...rev, id: null }, me, '삭제');
    return { ok: true };
  },

  // ── 변경내역서 ─────────────────────────────────────────────
  // 만들기: 기준 = 도급내역서(1차) 또는 직전 준공내역서(2차부터)
  'POST /api/boq/change/create': async (me, b) => {
    const { data: base } = await admin.from('boq_revisions').select('*').eq('id', b.base_id).single();
    if (!base || !['contract', 'final'].includes(base.kind)) throw [400, '도급내역서나 준공내역서를 기준으로 고르세요'];
    const p = await canBoq(me, base.project_id);
    const { data: all } = await admin.from('boq_revisions').select('id, kind, status').eq('project_id', base.project_id);
    if ((all || []).some((r) => r.kind === 'change' && r.status !== 'confirmed')) throw [400, '작성 중인 변경내역서가 있습니다. 그 차수를 확정한 뒤 다음 차수를 만드세요'];
    const seq = (all || []).filter((r) => r.kind === 'change').length + 1;
    const rule = cleanRule(b.rule);
    const name = `${seq}차 변경내역서`;
    const r = await buildChange(await fileBuf(base.storage_path), { sheet: base.sheet_name, headerRow: base.header_row, mode: 'pair', rule, outName: name });
    const path = `${base.project_id}/boq/${Date.now()}_change${seq}.xlsx`;
    await putFile(path, await r.makeFile());
    if (base.kind === 'contract' && base.status !== 'confirmed') {
      await admin.from('boq_revisions').update({ status: 'confirmed', locked: true, confirmed_by: me.id, confirmed_at: new Date().toISOString() }).eq('id', base.id);
      await log(base, me, '확정 (변경내역서를 만들어 자동 잠금)');
    }
    const rev = await saveRevision({
      project_id: base.project_id, kind: 'change', seq, title: name, base_id: base.id, storage_path: path,
      file_name: `${(p.name || '내역서').replace(/[\\/:*?"<>|]/g, '')}_${name}.xlsx`, sheet_name: r.outName, header_row: base.header_row, col_map: r.cm,
      totals: r.totals, params: { rule, edits: {}, new_items: [], orig_totals: r.origTotals, checks: r.checks, base_title: base.title }, created_by: me.id,
    }, r.items);
    if (b.save_rule && p.client) await saveRule(me, p, rule);
    await log(rev, me, '변경내역서 만들기', null, { base: base.title, rule });
    return { revision_id: rev.id };
  },

  // 저장: 변경 수량 · 단가 · 신규 항목 반영 → 엑셀 다시 만들기
  'POST /api/boq/change/save': async (me, b) => {
    const { data: rev } = await admin.from('boq_revisions').select('*').eq('id', b.revision_id).single();
    if (!rev || rev.kind !== 'change') throw [404, '변경내역서가 없습니다'];
    await canBoq(me, rev.project_id);
    if (rev.locked || rev.status === 'confirmed') throw [400, '확정된 변경내역서는 잠겨 있습니다. 잠금을 푼 뒤 고치세요'];
    const { data: base } = await admin.from('boq_revisions').select('*').eq('id', rev.base_id).single();
    if (!base) throw [400, '기준 내역서가 지워졌습니다'];
    const edits = cleanEdits(b.edits);
    const newItems = cleanNew(b.new_items);
    let r;
    const ud = await unitData(rev);
    try { r = await buildChange(await fileBuf(base.storage_path), { sheet: base.sheet_name, headerRow: base.header_row, mode: 'pair', rule: rev.params.rule, edits, newItems, outName: rev.sheet_name, ...ud }); }
    catch (e) { throw [400, e.message || String(e)]; }
    await putFile(rev.storage_path, await r.makeFile(), true);
    await admin.from('boq_items').delete().eq('revision_id', rev.id);
    await insertItems(rev.id, r.items);
    const params = { ...rev.params, edits, new_items: newItems, orig_totals: r.origTotals, checks: r.checks };
    await admin.from('boq_revisions').update({ totals: r.totals, params }).eq('id', rev.id);
    const changed = r.items.filter((x) => x.kind === 'item' && x.change && x.change !== 'same').length;
    await log(rev, me, '저장', null, { changed, contract: r.totals.contract });
    return { totals: r.totals, orig_totals: r.origTotals, checks: r.checks, changed, uc_prices: r.ucPrices };
  },

  // 확정: 도급 → 잠금 / 변경 → 잠금 + 준공내역서 생성
  'POST /api/boq/confirm': async (me, b) => {
    const { data: rev } = await admin.from('boq_revisions').select('*').eq('id', b.revision_id).single();
    if (!rev) throw [404, '없습니다'];
    await canBoq(me, rev.project_id);
    if (rev.status === 'confirmed') throw [400, '이미 확정되었습니다'];
    const now = new Date().toISOString();
    if (rev.kind === 'contract') {
      await admin.from('boq_revisions').update({ status: 'confirmed', locked: true, confirmed_by: me.id, confirmed_at: now }).eq('id', rev.id);
      await log(rev, me, '확정');
      return { ok: true };
    }
    if (rev.kind !== 'change') throw [400, '확정할 수 없는 내역서입니다'];
    const bad = (rev.params.checks || []).filter((c) => !c.ok && !c.warn);
    if (bad.length) throw [400, '확정 전 검사를 통과하지 못했습니다: ' + bad.map((c) => c.label).join(', ')];
    const { data: base } = await admin.from('boq_revisions').select('*').eq('id', rev.base_id).single();
    const { count } = await admin.from('boq_revisions').select('id', { count: 'exact', head: true }).eq('project_id', rev.project_id).eq('kind', 'final');
    const n = (count || 0) + 1;
    const r = await buildChange(await fileBuf(base.storage_path), {
      sheet: base.sheet_name, headerRow: base.header_row, mode: 'single', edits: rev.params.edits || {}, newItems: rev.params.new_items || [], outName: `준공내역서 v${n}`, ...(await unitData(rev)),
    });
    const path = `${rev.project_id}/boq/${Date.now()}_final${n}.xlsx`;
    await putFile(path, await r.makeFile());
    const parsed = r.parseOut();
    const fin = await saveRevision({
      project_id: rev.project_id, kind: 'final', seq: n, title: `준공내역서 v${n}`, base_id: rev.id, storage_path: path,
      file_name: rev.file_name.replace(/\d+차 변경내역서/, `준공내역서 v${n}`), sheet_name: r.outName, header_row: base.header_row, col_map: parsed.cm,
      totals: totalsOf(parsed.totals), params: { from: rev.title }, status: 'confirmed', locked: true, created_by: me.id, confirmed_by: me.id, confirmed_at: now,
    }, parsed.items);
    await admin.from('boq_revisions').update({ status: 'confirmed', locked: true, confirmed_by: me.id, confirmed_at: now }).eq('id', rev.id);
    const carried = await carryOver(rev.project_id, fin.id, parsed.items);
    await log(rev, me, '확정', null, { final: fin.title, contract: rev.totals?.contract, orig: rev.params.orig_totals?.contract, ...carried });
    await log(fin, me, '준공내역서 생성', null, { from: rev.title });
    return { ok: true, final_id: fin.id, carried };
  },

  // 잠금 해제: 회사 비밀번호 + 사유 → 이력
  'POST /api/boq/unlock': async (me, b) => {
    const { data: rev } = await admin.from('boq_revisions').select('*').eq('id', b.revision_id).single();
    if (!rev) throw [404, '없습니다'];
    const p = await canBoq(me, rev.project_id);
    if (!['contract', 'change'].includes(rev.kind)) throw [400, rev.kind === 'final' ? '준공내역서는 변경내역서의 잠금을 풀어 고칩니다' : '설계내역서는 잠금 해제가 필요 없습니다'];
    if (!rev.locked && rev.status !== 'confirmed') throw [400, '잠겨 있지 않습니다'];
    const reason = String(b.reason || '').trim();
    if (!reason) throw [400, '잠금을 푸는 사유를 적어 주세요'];
    const { data: sec } = await admin.from('boq_secrets').select('*').eq('company_id', p.company_id).maybeSingle();
    if (!sec) throw [400, '잠금 해제 비밀번호가 아직 없습니다. 관리자가 ④ 내역서 › 잠금 비밀번호에서 먼저 정해 주세요'];
    if (!checkPw(String(b.password || ''), sec.unlock_hash)) { await log(rev, me, '잠금 해제 실패 (비밀번호 틀림)', reason); throw [403, '비밀번호가 맞지 않습니다']; }
    // 이 차수를 기준으로 다음 차수가 있으면 못 풂
    const { data: kids } = await admin.from('boq_revisions').select('id, kind').eq('base_id', rev.id);
    const kidIds = (kids || []).map((k) => k.id);
    const blocking = (kids || []).filter((k) => k.kind !== 'final');
    if (kidIds.length) {
      const { data: grand } = await admin.from('boq_revisions').select('id').in('base_id', kidIds);
      if (blocking.length || (grand || []).length) throw [400, '이 내역서를 기준으로 만든 다음 차수가 있어 풀 수 없습니다'];
    }
    await admin.from('boq_revisions').update({ status: 'draft', locked: false }).eq('id', rev.id);
    await log(rev, me, '잠금 해제', reason);
    return { ok: true };
  },

  // 잠금 해제 비밀번호 정하기 (관리자)
  'POST /api/boq/password': async (me, b) => {
    if (!['system_admin', 'company_admin'].includes(me.role)) throw [403, '관리자만 정할 수 있습니다'];
    const company_id = me.role === 'system_admin' ? (b.company_id || me.company_id) : me.company_id;
    if (!company_id) throw [400, '회사를 고르세요'];
    const pw = String(b.password || '');
    if (pw.length < 4) throw [400, '비밀번호는 4자 이상'];
    const { error } = await admin.from('boq_secrets').upsert({ company_id, unlock_hash: hashPw(pw), updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'company_id' });
    if (error) throw [400, error.message];
    await admin.from('activity_log').insert({ user_id: me.id, action: '내역서 잠금 비밀번호 변경', target: company_id });
    return { ok: true };
  },

  // 현장 앱(공릉천교 '내역' 탭)으로 확정 내역서 보내기 — 화면이 엔진으로 만든 보기용 묶음을 public.docs 에 씀
  'POST /api/boq/publish-app': async (me, b) => {
    const p = await canBoq(me, b.project_id);
    if (!['system_admin', 'company_admin', 'staff'].includes(me.role)) throw [403, '본사 계정만 보낼 수 있습니다'];
    const { data: t } = await admin.from('boq_app_targets').select('*').eq('project_id', p.id).maybeSingle();
    if (!t) throw [400, '이 공사는 현장 앱과 이어져 있지 않습니다 (시스템 관리자가 ④ 내역서 › 한눈에서 잇습니다)'];
    const d = b.payload;
    if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.tree)) throw [400, '보낼 내역서가 없습니다'];
    const size = JSON.stringify(d).length;
    if (size > 4e6) throw [400, '내역서가 너무 큽니다'];
    const { data: base } = await admin.from('boq_revisions').select('id, project_id, title, status, locked').eq('id', d.base?.id).maybeSingle();
    if (!base || base.project_id !== p.id || !(base.locked || base.status === 'confirmed')) throw [400, '확정된 도급 · 준공내역서만 보낼 수 있습니다'];
    const now = new Date().toISOString();
    const data = { ...d, project: { ...(d.project || {}), name: p.name, client: p.client }, sent_at: now, sent_by: me.name || me.username || '' };
    const { error } = await admin.schema('public').from('docs').upsert({ col: 'boq', id: t.doc_id, data, deleted: false }, { onConflict: 'col,id' });
    if (error) throw [400, '현장 앱에 쓰지 못했습니다: ' + error.message];
    await admin.from('boq_app_targets').update({ sent_at: now, sent_title: base.title, sent_by: me.id }).eq('project_id', p.id);
    await log({ ...base, project_id: p.id }, me, '현장 앱으로 보냄', null, { app: t.app, size });
    return { ok: true, sent_at: now };
  },

  // 차수 · 기성 · 하도급 엑셀 (화면이 계산한 표 → 엑셀, 읽기 전용)
  'POST /api/boq/sheet-xlsx': async (me, b) => {
    await canBoq(me, b.project_id);
    checkDoc(b.doc);
    const buf = await buildSheetXlsx(b.doc);
    const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const name = String(b.doc.file || '내역서').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80);
    return { base64: buf.toString('base64'), name: `${name}_${stamp}.xlsx` };
  },

  // 일위대가 작성용 단가 자료 (기준 엑셀의 자재 · 노임 · 목록 · 호표)
  'POST /api/boq/refs': async (me, b) => {
    const { data: rev } = await admin.from('boq_revisions').select('*').eq('id', b.revision_id).single();
    if (!rev) throw [404, '없습니다'];
    await canBoq(me, rev.project_id);
    const { data: base } = await admin.from('boq_revisions').select('*').eq('id', rev.base_id || rev.id).single();
    const src = base || rev;
    if (refsCache.has(src.storage_path)) return refsCache.get(src.storage_path);
    const model = await readWorkbook(await fileBuf(src.storage_path));
    const out = collectRefs(model, new Evaluator(model), [src.sheet_name]);
    refsCache.set(src.storage_path, out); if (refsCache.size > 6) refsCache.delete(refsCache.keys().next().value);
    return out;
  },

  // 발주처 규칙 저장
  'POST /api/boq/rule': async (me, b) => {
    const p = await canBoq(me, b.project_id);
    if (!p.client) throw [400, '프로젝트에 발주처가 없습니다 (정보 수정에서 입력)'];
    await saveRule(me, p, cleanRule(b.rule));
    return { ok: true };
  },
};

const COLOR_OK = ['black', 'red', 'blue'];
function cleanRule(r = {}) {
  return {
    top: r.top === 'orig' ? 'orig' : 'change',
    orig_color: COLOR_OK.includes(r.orig_color) ? r.orig_color : 'black',
    chg_color: COLOR_OK.includes(r.chg_color) ? r.chg_color : 'red',
    merge_text: r.merge_text !== false,
  };
}
async function saveRule(me, p, rule) {
  await admin.from('boq_client_rules').upsert({ company_id: p.company_id, client: p.client, ...rule, updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'company_id,client' });
}
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));
function cleanEdits(e = {}) {
  const out = {};
  for (const [row, x] of Object.entries(e || {})) {
    if (!/^\d+$/.test(row)) continue;
    const y = {};
    for (const k of ['qty', 'mat_price', 'lab_price', 'exp_price']) { const v = numOrNull(x?.[k]); if (v !== undefined) y[k] = k === 'qty' ? v : Math.trunc(v); }
    if (/^[\w-]{1,64}$/.test(String(x?.unit_cost_id || ''))) y.unit_cost_id = String(x.unit_cost_id);
    if (Object.keys(y).length) out[row] = y;
  }
  return out;
}
function cleanNew(list = []) {
  return (list || []).slice(0, 500).map((x, k) => ({
    id: String(x.id || k), parent_row: Math.trunc(Number(x.parent_row)), name: String(x.name || '').slice(0, 200).trim() || '(이름 없음)',
    spec: String(x.spec || '').slice(0, 200), unit: String(x.unit || '').slice(0, 20), note: String(x.note || '').slice(0, 100),
    ...(/^[\w-]{1,64}$/.test(String(x.unit_cost_id || '')) ? { unit_cost_id: String(x.unit_cost_id) } : {}),
    qty: numOrNull(x.qty) ?? 0, mat_price: Math.trunc(numOrNull(x.mat_price) ?? 0), lab_price: Math.trunc(numOrNull(x.lab_price) ?? 0), exp_price: Math.trunc(numOrNull(x.exp_price) ?? 0),
  }));
}
function hashPw(pw) { const salt = randomBytes(16); return 'scrypt$' + salt.toString('hex') + '$' + scryptSync(pw, salt, 32).toString('hex'); }
function checkPw(pw, h) {
  const [, salt, key] = String(h).split('$');
  if (!salt || !key) return false;
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 32), b = Buffer.from(key, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
