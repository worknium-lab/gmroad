// ④ 내역서 › 차수 · 기성 · 하도급 엑셀 — 화면(적산 엔진)이 계산한 표를 받아 엑셀로 꾸밈
//   금액 칸은 화면이 보낸 수식(TRUNC · SUBTOTAL · SUM과 칸 주소만 허용)을 그대로 넣고, 계산값을 캐시값으로 둠
//   자리표: {r} = 이 줄, {end} = 이 줄 + span(공종 아래 줄 수), {first} = 첫 데이터 줄, {prev} = 바로 윗줄
import ExcelJS from 'exceljs';

const START = 4; // 1행 제목 · 2행 부제 · 3행 머리글
const SAFE = /^(?:TRUNC|SUBTOTAL|SUM|[A-Z]{1,3}(?:\d+|\{(?:r|end|first|prev)\})|\d+(?:\.\d+)?|[+\-*/(),:\s])+$/;
const font = { name: '맑은 고딕', size: 10 };
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const FILL = { g0: 'FFE8EEF7', g1: 'FFF4F7FB', total: 'FFF2F2F2' };

export function checkDoc(doc) {
  if (!doc || !Array.isArray(doc.sheets) || !doc.sheets.length || doc.sheets.length > 8) throw [400, '엑셀로 만들 표가 없습니다'];
  let n = 0;
  for (const s of doc.sheets) {
    if (!Array.isArray(s.cols) || !s.cols.length || s.cols.length > 40 || !Array.isArray(s.rows)) throw [400, '표 모양이 잘못되었습니다'];
    n += s.rows.length;
    for (const r of s.rows) for (const c of r.c || []) if (c && typeof c === 'object' && (typeof c.f !== 'string' || !SAFE.test(c.f))) throw [400, '쓸 수 없는 수식이 있습니다'];
  }
  if (n > 30000) throw [400, '줄이 너무 많습니다'];
}

export async function buildSheetXlsx(doc) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'GM 통합관리';
  for (const s of doc.sheets) {
    const name = String(s.name || '표').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    const ws = wb.addWorksheet(name, {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3' },
      views: [{ state: 'frozen', ySplit: 3 }],
    });
    ws.columns = s.cols.map((c) => ({ width: Math.min(60, Math.max(5, Number(c.w) || 12)) }));
    ws.mergeCells(1, 1, 1, s.cols.length);
    Object.assign(ws.getCell(1, 1), { value: String(s.title || ''), font: { ...font, size: 15, bold: true } });
    ws.getRow(1).height = 26;
    if (s.sub) { ws.mergeCells(2, 1, 2, s.cols.length); Object.assign(ws.getCell(2, 1), { value: String(s.sub), font: { ...font, color: { argb: 'FF555C66' } } }); }
    const hr = ws.getRow(3); hr.values = s.cols.map((c) => String(c.h || '')); hr.height = 22;
    hr.eachCell((c) => { c.font = { ...font, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = box; });

    s.rows.forEach((row, i) => {
      const r = START + i;
      const sub = (f) => f.replace(/\{r\}/g, r).replace(/\{end\}/g, r + Math.max(0, Number(row.span) || 0)).replace(/\{first\}/g, START).replace(/\{prev\}/g, Math.max(START, r - 1));
      const x = ws.getRow(r);
      s.cols.forEach((col, ci) => {
        const v = (row.c || [])[ci];
        const cell = x.getCell(ci + 1);
        if (v && typeof v === 'object') cell.value = { formula: sub(v.f), result: typeof v.v === 'number' ? v.v : undefined };
        else cell.value = v === undefined || v === '' ? null : v;
        cell.font = { ...font, bold: row.style === 'g0' || row.style === 'total' };
        cell.border = box;
        if (col.fmt) cell.numFmt = col.fmt;
        if (col.align) cell.alignment = { horizontal: col.align };
        if (FILL[row.style]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[row.style] } };
      });
      if (row.indent) x.getCell(1).alignment = { indent: Math.min(10, Number(row.indent)) };
      if (row.style === 'g1') x.font = { ...font, bold: true };
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
