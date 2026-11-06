// ④ 내역서 API
import { admin } from '../lib.mjs';
import { readWorkbook } from './xlsx.mjs';
import { Evaluator } from './evaluator.mjs';
import { findBoqSheets, parseBoq } from './detect.mjs';
import { buildContract } from './contract.mjs';

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
  const { data: p } = await admin.from('projects').select('id, company_id').eq('id', projectId).single();
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

async function saveRevision(row, items) {
  const { data: rev, error } = await admin.from('boq_revisions').insert(row).select().single();
  if (error) throw [400, error.message];
  const rows = items.map((it) => ({
    revision_id: rev.id, row: it.row, parent_row: it.parent_row ?? null, level: it.level, kind: it.kind, section: it.section,
    name: it.name, spec: it.spec || null, unit: it.unit || null, qty: it.qty, mat_price: it.mat_price, lab_price: it.lab_price, exp_price: it.exp_price,
    mat_amt: Math.trunc(it.mat_amt || 0), lab_amt: Math.trunc(it.lab_amt || 0), exp_amt: Math.trunc(it.exp_amt || 0), total_amt: Math.trunc(it.total_amt || 0),
    note: it.note || null, price_ref: it.price_ref || null,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await admin.from('boq_items').insert(rows.slice(i, i + 500));
    if (e) { await admin.from('boq_revisions').delete().eq('id', rev.id); throw [400, e.message]; }
  }
  return rev;
}
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
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (upErr) throw [400, '파일 저장 실패: ' + upErr.message];
    const { count } = await admin.from('boq_revisions').select('id', { count: 'exact', head: true }).eq('project_id', b.project_id).eq('kind', 'design');
    const rev = await saveRevision({
      project_id: b.project_id, kind: 'design', seq: (count || 0) + 1, title: '설계내역서' + (count ? ` (${count + 1})` : ''),
      source_document_id: doc.id, storage_path: path, file_name: doc.file_name, sheet_name: pick.sheet, header_row: pick.headerRow,
      col_map: parsed.cm, totals: totalsOf(parsed.totals), check_result: check, created_by: me.id, status: 'confirmed', locked: true,
    }, parsed.items);
    await admin.from('activity_log').insert({ project_id: b.project_id, user_id: me.id, action: '설계내역서 가져오기', target: doc.file_name });
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
    const { error } = await admin.storage.from(BUCKET).upload(path, out, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (error) throw [400, '파일 저장 실패: ' + error.message];
    const { count } = await admin.from('boq_revisions').select('id', { count: 'exact', head: true }).eq('project_id', base.project_id).eq('kind', 'contract');
    const rev = await saveRevision({
      project_id: base.project_id, kind: 'contract', seq: (count || 0) + 1, title: '도급내역서' + (count ? ` (${count + 1})` : ''), base_id: base.id,
      storage_path: path, file_name: name, sheet_name: base.sheet_name, header_row: base.header_row, col_map: r.after.cm,
      totals: totalsOf(r.after.totals), params: { rate, target, fixed_rows: b.fixed_rows || [], no_rate_rows: b.no_rate_rows || [], result: r.result },
      created_by: me.id,
    }, r.after.items);
    await admin.from('activity_log').insert({ project_id: base.project_id, user_id: me.id, action: '도급내역서 생성', target: `낙찰률 ${(rate * 100).toFixed(3)}% · 도급액 ${r.result.reached ?? r.result.afterRate}` });
    return { revision_id: rev.id, result: r.result };
  },

  // 차수 지우기 (확정 전만)
  'POST /api/boq/delete': async (me, b) => {
    const { data: rev } = await admin.from('boq_revisions').select('*').eq('id', b.revision_id).single();
    if (!rev) throw [404, '없습니다'];
    await canBoq(me, rev.project_id);
    if (rev.kind !== 'design' && rev.status === 'confirmed') throw [400, '확정된 내역서는 지울 수 없습니다'];
    const { count } = await admin.from('boq_revisions').select('id', { count: 'exact', head: true }).eq('base_id', rev.id);
    if (count) throw [400, '이 내역서로 만든 다음 차수가 있어 지울 수 없습니다'];
    await admin.storage.from(BUCKET).remove([rev.storage_path]);
    await admin.from('boq_revisions').delete().eq('id', rev.id);
    await admin.from('activity_log').insert({ project_id: rev.project_id, user_id: me.id, action: '내역서 차수 삭제', target: rev.title });
    return { ok: true };
  },
};
