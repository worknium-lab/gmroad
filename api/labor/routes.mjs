// ⑨ 노무비 API — 전자카드 엑셀 읽기, 결과 엑셀(수식 포함) 만들기, 잠금 해제
import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { admin } from '../lib.mjs';

const require = createRequire(import.meta.url);
const C = require('./core.cjs');
const BUCKET = 'project-files';

async function canLabor(me, projectId) {
  const { data: p } = await admin.from('projects').select('id, company_id, name').eq('id', projectId).single();
  if (!p) throw [404, '프로젝트가 없습니다'];
  if (me.role === 'system_admin' || (me.role === 'company_admin' && me.company_id === p.company_id)) return p;
  if (me.role === 'staff') {
    const { data: m } = await admin.from('project_members').select('can_labor').eq('project_id', projectId).eq('user_id', me.id).maybeSingle();
    if (m?.can_labor) return p;
  }
  throw [403, '이 프로젝트의 노무비 권한이 없습니다 (① 개요 › 참여자 · 권한에서 노무비 체크)'];
}
async function download(path) {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw [400, '파일을 받을 수 없습니다: ' + (error?.message || path)];
  return Buffer.from(await data.arrayBuffer());
}

/** 전자카드 파일 → 표(행 배열). 시트가 여러 개면 머리글을 가장 잘 찾은 시트 */
export function readCardFile(buf, opt = {}) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false, codepage: 949 });
  let best = null;
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const h = C.detectHeader(aoa);
    if (!best || h.score > best.h.score) best = { name, aoa, h };
  }
  if (!best || best.h.row < 0) throw [400, '성명 열을 찾지 못했습니다. 전자카드 근무내역(출퇴근) 엑셀이 맞는지 확인하세요'];
  const row = Number.isInteger(opt.header_row) ? opt.header_row : best.h.row;
  const map = opt.map && Object.keys(opt.map).length ? opt.map : best.h.map;
  const records = C.extractRecords(best.aoa, row, map);
  const heads = (best.aoa[row] || []).map((h, i) => String(h || `(빈 열 ${i + 1})`));
  return { sheet: best.name, header_row: row, map, heads, sample: best.aoa.slice(row + 1, row + 6), records, months: C.monthsOf(records), sheets: wb.SheetNames };
}

/** 저장된 설정 + 기본값 */
export function settingsOf(saved = {}, ym) {
  const d = C.defaultSettings();
  const S = { ...d, ...saved, rates: { ...d.rates, ...(saved.rates || {}) } };
  S.year = +ym.slice(0, 4); S.month = +ym.slice(5, 7);
  return S;
}

export async function buildLabor({ month, saved, roster, jobRates }) {
  const S = settingsOf(saved?.settings, month.ym);
  const recs = (month.records || []).filter((r) => r.date?.slice(0, 7) === month.ym);
  const workers = C.buildWorkers(recs, (roster || []).map((w) => ({ ...w, wage: w.wage ?? null })));
  const { wb, st } = C.buildWorkbook(ExcelJS, S, month.records || [], workers, jobRates || []);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const totals = { heads: st.rows.filter((r) => r.nDays).length, total: st.sum.total, amount: st.sum.amount, ded: st.sum.ded, net: st.sum.net };
  return { buf, totals, st };
}

function checkPw(pw, h) {
  const [, salt, key] = String(h).split('$');
  if (!salt || !key) return false;
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 32), b = Buffer.from(key, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const laborRoutes = {
  'POST /api/labor/parse': async (me, b) => {
    await canLabor(me, b.project_id);
    if (!String(b.path || '').startsWith(b.project_id + '/')) throw [400, '잘못된 파일 경로'];
    try { return readCardFile(await download(b.path), { map: b.map, header_row: b.header_row }); }
    catch (e) { if (Array.isArray(e)) throw e; throw [400, '엑셀을 읽을 수 없습니다: ' + e.message]; }
  },

  'POST /api/labor/build': async (me, b) => {
    const { data: month } = await admin.from('labor_months').select('*').eq('id', b.month_id).single();
    if (!month) throw [404, '노무비 자료가 없습니다'];
    await canLabor(me, month.project_id);
    const [{ data: saved }, { data: roster }] = await Promise.all([
      admin.from('labor_settings').select('*').eq('project_id', month.project_id).maybeSingle(),
      admin.from('labor_workers').select('*').eq('project_id', month.project_id),
    ]);
    const { buf, totals } = await buildLabor({ month, saved, roster, jobRates: saved?.job_rates || [] });
    const path = `${month.project_id}/labor/${month.ym}/labor_${month.ym}.xlsx`;
    const { error } = await admin.storage.from(BUCKET).upload(path, buf, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (error) throw [400, '파일 저장 실패: ' + error.message];
    await admin.from('labor_months').update({ output_path: path, output_at: new Date().toISOString(), totals, updated_at: new Date().toISOString() }).eq('id', month.id);
    await admin.from('activity_log').insert({ project_id: month.project_id, user_id: me.id, action: '노무비 엑셀 만들기', target: month.ym });
    return { path, totals };
  },

  'POST /api/labor/unlock': async (me, b) => {
    const { data: month } = await admin.from('labor_months').select('*').eq('id', b.month_id).single();
    if (!month) throw [404, '노무비 자료가 없습니다'];
    const p = await canLabor(me, month.project_id);
    if (!month.locked) throw [400, '잠겨 있지 않습니다'];
    const reason = String(b.reason || '').trim();
    if (!reason) throw [400, '잠금을 푸는 사유를 적어 주세요'];
    const { data: sec } = await admin.from('boq_secrets').select('*').eq('company_id', p.company_id).maybeSingle();
    if (!sec) throw [400, '잠금 해제 비밀번호가 아직 없습니다. 관리자가 ④ 내역서 › 잠금 비밀번호에서 먼저 정해 주세요'];
    const log = (action) => admin.from('activity_log').insert({ project_id: month.project_id, user_id: me.id, action, target: month.ym, reason });
    if (!checkPw(String(b.password || ''), sec.unlock_hash)) { await log('노무비 잠금 해제 실패 (비밀번호 틀림)'); throw [403, '비밀번호가 맞지 않습니다']; }
    await admin.from('labor_months').update({ locked: false, updated_at: new Date().toISOString() }).eq('id', month.id);
    await log('노무비 잠금 해제');
    return { ok: true };
  },
};
