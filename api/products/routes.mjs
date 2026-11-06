// 제품 · 실적 — 납품이력 엑셀 (금액 칸은 수식 =TRUNC(수량*단가,0), 합계는 SUBTOTAL)
import ExcelJS from 'exceljs';
import { admin } from '../lib.mjs';

const OFFICE = ['system_admin', 'company_admin', 'staff'];

export async function buildDeliveriesXlsx({ title, rows, companies }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'GM 통합관리';
  const ws = wb.addWorksheet('납품이력', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3' },
    views: [{ state: 'frozen', ySplit: 3 }],
  });
  const head = ['납품일', '회사', '구분', '제품명', '규격', '단위', '수량', '단가', '금액', '공사명', '수요기관 · 발주처', '시공사', '비고'];
  const widths = [12, 12, 7, 24, 18, 7, 10, 13, 15, 30, 20, 16, 20];
  ws.columns = widths.map((w) => ({ width: w }));
  const font = { name: '맑은 고딕', size: 10 };
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  ws.mergeCells(1, 1, 1, head.length);
  Object.assign(ws.getCell(1, 1), { value: title, font: { ...font, size: 15, bold: true } });
  ws.getRow(1).height = 26;
  const hr = ws.getRow(3); hr.values = head; hr.height = 22;
  hr.eachCell((c) => { c.font = { ...font, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = box; });

  let r = 4;
  for (const d of rows) {
    const row = ws.getRow(r);
    row.values = [
      d.delivered_on ? new Date(d.delivered_on + 'T00:00:00Z') : null, companies.get(d.company_id) || '', d.kind, d.products?.name || '', d.products?.spec || '', d.products?.unit || '',
      Number(d.qty), Number(d.price), { formula: `TRUNC(G${r}*H${r},0)`, result: Number(d.amount) }, d.project_name || '', d.client || '', d.contractor || '', d.note || '',
    ];
    row.eachCell({ includeEmpty: true }, (c, i) => { if (i <= head.length) { c.font = font; c.border = box; } });
    row.getCell(1).numFmt = 'yyyy-mm-dd';
    row.getCell(7).numFmt = '#,##0.###';
    row.getCell(8).numFmt = '#,##0'; row.getCell(9).numFmt = '#,##0';
    row.getCell(3).alignment = { horizontal: 'center' };
    r++;
  }
  const last = r - 1;
  const tr = ws.getRow(r);
  tr.getCell(1).value = '합계'; ws.mergeCells(r, 1, r, 8);
  tr.getCell(9).value = { formula: rows.length ? `SUBTOTAL(9,I4:I${last})` : '0', result: rows.reduce((s, d) => s + Number(d.amount), 0) };
  for (let c = 1; c <= head.length; c++) { const x = tr.getCell(c); x.font = { ...font, bold: true }; x.border = box; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }; }
  tr.getCell(1).alignment = { horizontal: 'center' }; tr.getCell(9).numFmt = '#,##0';
  // 관급 · 사급 소계
  ['관급', '사급'].forEach((k, i) => {
    const rr = ws.getRow(r + 1 + i);
    rr.getCell(8).value = k; rr.getCell(8).alignment = { horizontal: 'right' };
    rr.getCell(9).value = { formula: rows.length ? `SUMIFS(I4:I${last},C4:C${last},"${k}")` : '0', result: rows.filter((d) => d.kind === k).reduce((s, d) => s + Number(d.amount), 0) };
    rr.getCell(9).numFmt = '#,##0'; rr.getCell(8).font = font; rr.getCell(9).font = font;
  });
  if (rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: last, column: head.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const productRoutes = {
  'POST /api/products/deliveries-xlsx': async (me, b) => {
    if (!OFFICE.includes(me.role)) throw [403, '본사 계정만 볼 수 있습니다'];
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) throw [400, '내보낼 납품 기록이 없습니다'];
    if (ids.length > 20000) throw [400, '너무 많습니다. 연도로 나눠서 받으세요'];
    const rows = [];
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await admin.from('deliveries').select('*, products(name, spec, unit)').in('id', ids.slice(i, i + 500));
      if (error) throw [500, error.message];
      rows.push(...data);
    }
    rows.sort((a, b2) => b2.delivered_on.localeCompare(a.delivered_on) || String(a.created_at).localeCompare(String(b2.created_at)));
    const { data: cos } = await admin.from('companies').select('id, name');
    const companies = new Map((cos || []).map((c) => [c.id, c.name]));
    const coName = b.company && b.company !== 'all' ? companies.get(b.company) : '전체 회사';
    const parts = [coName, b.year && b.year !== 'all' ? `${b.year}년` : '', b.kind && b.kind !== 'all' ? b.kind : ''].filter(Boolean);
    const buf = await buildDeliveriesXlsx({ title: `납품이력 (${parts.join(' · ')})`, rows, companies });
    const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    return { base64: buf.toString('base64'), name: `납품이력_${parts.join('_').replace(/\s+/g, '')}_${stamp}.xlsx` };
  },
};
