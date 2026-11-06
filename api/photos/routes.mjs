// 사진대지 엑셀 — A4 세로, 한 쪽에 2·3·4·6장, 사진 + 일자 · 위치 · 내용 칸
import ExcelJS from 'exceljs';
import { admin } from '../lib.mjs';

const BUCKET = 'project-files';
export const LAYOUT = { 2: { cols: 1, rows: 2 }, 3: { cols: 1, rows: 3 }, 4: { cols: 2, rows: 2 }, 6: { cols: 2, rows: 3 } };
const EMU = 9525;              // 1px
const COLS = 8, COL_W = 11;    // 열 8개 × 너비 11
const COL_PX = Math.trunc(((COL_W * 7 + 5) / 7) * 256) / 256 * 7; // 엑셀이 실제로 그리는 열 너비(px)
const PAGE_PT = 770;           // A4 세로 · 여백 1cm 안쪽 높이(pt) 근사

async function canView(me, projectId) {
  const { data: p } = await admin.from('projects').select('id, company_id, name').eq('id', projectId).single();
  if (!p) throw [404, '프로젝트가 없습니다'];
  if (me.role === 'system_admin' || (me.role === 'company_admin' && me.company_id === p.company_id)) return p;
  const { data: m } = await admin.from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', me.id).maybeSingle();
  if (m) return p;
  throw [403, '이 프로젝트를 볼 권한이 없습니다'];
}

const dotDay = (d) => { const [y, m, dd] = String(d).split('-').map(Number); return `${y}. ${m}. ${dd}.`; };
const safeName = (s) => String(s || '사진대지').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);

/** JPEG/PNG 크기 읽기 (DB에 크기가 없을 때) */
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ext: 'png' };
  let o = 2;
  while (o < buf.length) {
    if (buf[o] !== 0xff) break;
    const mk = buf[o + 1], len = buf.readUInt16BE(o + 2);
    if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7), ext: 'jpeg' };
    o += 2 + len;
  }
  return { w: 4, h: 3, ext: 'jpeg' };
}

/**
 * 사진대지 엑셀 만들기
 * @param {{title:string, project:string, per_page:number, items:{buf:Buffer, day:string, where:string, caption:string}[]}} d
 */
export async function buildSheetXlsx(d) {
  const L = LAYOUT[d.per_page] || LAYOUT[3];
  const wb = new ExcelJS.Workbook(); wb.creator = 'GM 통합관리';
  const ws = wb.addWorksheet('사진대지', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
  });
  ws.columns = Array.from({ length: COLS }, () => ({ width: COL_W }));
  const font = { name: '맑은 고딕', size: 10 };
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const head = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  const CAP_PT = 18, GAP_PT = 6, TITLE_PT = 34, META_PT = 20;
  const imgPt = Math.floor(((PAGE_PT - TITLE_PT - META_PT - GAP_PT) / L.rows - CAP_PT * 3 - GAP_PT));
  const imgPx = Math.round(imgPt * 4 / 3);
  const span = COLS / L.cols;                  // 한 칸 블록이 차지하는 열 수
  const blockPx = span * COL_PX;
  const pages = Math.ceil(d.items.length / d.per_page) || 1;

  const cell = (r, c1, c2, v, o = {}) => {
    if (c2 > c1) ws.mergeCells(r, c1, r, c2);
    const x = ws.getCell(r, c1); x.value = v; x.font = { ...font, ...(o.font || {}) };
    x.alignment = o.shrink ? { vertical: 'middle', horizontal: 'left', shrinkToFit: true, indent: 1 } : { vertical: 'middle', horizontal: o.h || 'left', wrapText: true, indent: o.h ? 0 : 1 };
    for (let c = c1; c <= c2; c++) { ws.getCell(r, c).border = box; if (o.fill) ws.getCell(r, c).fill = o.fill; }
  };

  let r = 1;
  for (let pg = 0; pg < pages; pg++) {
    ws.getRow(r).height = TITLE_PT;
    ws.mergeCells(r, 1, r, COLS);
    const t = ws.getCell(r, 1); t.value = '사 진 대 지'; t.font = { ...font, size: 18, bold: true }; t.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = 1; c <= COLS; c++) ws.getCell(r, c).border = { bottom: { style: 'medium' } };
    r++;
    ws.getRow(r).height = META_PT;
    cell(r, 1, 1, '공 사 명', { h: 'center', fill: head }); cell(r, 2, 6, d.project); cell(r, 7, 7, '쪽', { h: 'center', fill: head }); cell(r, 8, 8, `${pg + 1} / ${pages}`, { h: 'center' });
    r++;
    ws.getRow(r).height = GAP_PT; r++;
    const list = d.items.slice(pg * d.per_page, (pg + 1) * d.per_page);
    for (let row = 0; row < L.rows; row++) {
      const imgRow = r;
      ws.getRow(imgRow).height = imgPt;
      for (let c = 0; c < L.cols; c++) {
        const it = list[row * L.cols + c];
        const c1 = c * span + 1, c2 = c1 + span - 1;
        // 사진 칸 테두리 + 아래 3줄
        ws.mergeCells(imgRow, c1, imgRow, c2);
        for (let cc = c1; cc <= c2; cc++) ws.getCell(imgRow, cc).border = { top: thin, left: cc === c1 ? thin : undefined, right: cc === c2 ? thin : undefined };
        const labels = [['일 자', it ? dotDay(it.day) : ''], ['위 치', it?.where || ''], ['내 용', it?.caption || '']];
        labels.forEach(([k, v], i) => { ws.getRow(imgRow + 1 + i).height = CAP_PT; cell(imgRow + 1 + i, c1, c1, k, { h: 'center', fill: head }); cell(imgRow + 1 + i, c1 + 1, c2, v, { shrink: true }); });
        if (!it) continue;
        const sz = imageSize(it.buf);
        const maxW = blockPx - 10, maxH = imgPx - 10;
        const s = Math.min(maxW / sz.w, maxH / sz.h);
        const w = Math.max(1, Math.floor(sz.w * s)), h = Math.max(1, Math.floor(sz.h * s));
        const offX = (blockPx - w) / 2, offY = (imgPx - h) / 2;
        const colIdx = Math.min(span - 1, Math.floor(offX / COL_PX));
        const id = wb.addImage({ buffer: it.buf, extension: sz.ext });
        ws.addImage(id, {
          tl: { nativeCol: c1 - 1 + colIdx, nativeColOff: Math.round((offX - colIdx * COL_PX) * EMU), nativeRow: imgRow - 1, nativeRowOff: Math.round(offY * EMU) },
          ext: { width: w, height: h }, editAs: 'oneCell',
        });
      }
      r = imgRow + 4;
      ws.getRow(r).height = GAP_PT; r++;
    }
    if (pg < pages - 1) ws.getRow(r - 1).addPageBreak();
  }
  ws.pageSetup.printArea = `A1:H${r - 1}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const photoRoutes = {
  'POST /api/photos/sheet-xlsx': async (me, b) => {
    const { data: sh } = await admin.from('photo_sheets').select('*').eq('id', b.sheet_id).single();
    if (!sh) throw [404, '사진대지가 없습니다'];
    const proj = await canView(me, sh.project_id);
    const ids = (sh.items || []).map((i) => i.photo_id);
    if (!ids.length) throw [400, '사진이 없습니다'];
    if (ids.length > 300) throw [400, '한 번에 300장까지 만들 수 있습니다. 나눠서 만드세요'];
    const { data: ps } = await admin.from('photos').select('id, storage_path, taken_day, kind, memo, caption, location_id, work_item_id').eq('project_id', sh.project_id).in('id', ids);
    const byId = new Map((ps || []).map((p) => [p.id, p]));
    const [{ data: locs }, { data: works }] = await Promise.all([
      admin.from('locations').select('id, name, facilities!inner(name, project_id)').eq('facilities.project_id', sh.project_id),
      admin.from('work_items').select('id, name').eq('project_id', sh.project_id),
    ]);
    const ln = new Map((locs || []).map((l) => [l.id, `${l.facilities?.name || ''} ${l.name}`.trim()]));
    const wn = new Map((works || []).map((w) => [w.id, w.name]));
    const items = [];
    for (const it of sh.items) {
      const p = byId.get(it.photo_id); if (!p) continue;
      const { data, error } = await admin.storage.from(BUCKET).download(p.storage_path);
      if (error || !data) continue;
      items.push({
        buf: Buffer.from(await data.arrayBuffer()), day: p.taken_day,
        where: [ln.get(p.location_id), wn.get(p.work_item_id)].filter(Boolean).join(' · '),
        caption: it.caption || p.caption || [p.kind, p.memo].filter(Boolean).join(' · '),
      });
    }
    if (!items.length) throw [400, '사진 파일을 받을 수 없습니다'];
    const buf = await buildSheetXlsx({ title: sh.title, project: proj.name, per_page: sh.per_page, items });
    const name = `${safeName(sh.title)}.xlsx`;
    const path = `${sh.project_id}/sheets/${Date.now()}_photo_sheet.xlsx`; // 저장소 키는 영문만
    const { error } = await admin.storage.from(BUCKET).upload(path, buf, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (error) throw [500, '저장 실패: ' + error.message];
    return { path, name, count: items.length };
  },
};
