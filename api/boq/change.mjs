// 변경내역서 · 준공내역서 만들기
//
// 기준 내역서(도급 또는 직전 준공) 시트를 그대로 두고, 같은 파일 안에 새 시트를 만듭니다.
//  mode 'pair'  (변경내역서): 항목마다 두 줄 — 당초 줄 / 변경 줄 (윗줄 · 아랫줄 · 색은 발주처 규칙)
//      · 품명 · 규격 · 단위는 두 줄을 합친 한 칸 (merge_text)
//      · 당초 수량 · 단가 = 값 복사 (엑셀에서 열어도 바뀌지 않음)
//      · 변경 단가 = 당초 단가 칸을 가리키는 수식 (=G12). 단가를 바꾸거나 신규 항목이면 값
//      · 금액 · 소계 · 원가계산서 = 기준 시트의 수식을 그대로 옮기되 행 번호만 당초 줄 / 변경 줄로 바꿈
//  mode 'single' (준공내역서): 변경 값으로 한 줄 내역서 (수량 · 단가는 값, 금액은 수식)
// 신규 항목은 소계 수식 끝에 '+새 행'을 붙여 위쪽 합계에 들어가게 합니다.
import JSZip from 'jszip';
import { readWorkbook, sheetFiles, finishZip, colToNum, numToCol, splitAddr, encode, decode } from './xlsx.mjs';
import { Evaluator } from './evaluator.mjs';
import { parseBoq } from './detect.mjs';
import { parseSheetRef, sheetRef } from './refs.mjs';

export const COLORS = { black: null, red: 'FFFF0000', blue: 'FF0000FF' };
const clean = (x) => Number(x.toPrecision(15));
const REF = /^(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 같은 시트 참조의 행 번호를 mapRow로 바꿈. 다른 시트 참조 · 문자열은 그대로.
 *  여러 행에 걸친 범위(H34:H41)는 두 줄 구조에서 쓸 수 없어 칸 목록으로 풀어 씀 */
export function remapFormula(f, mapRow) {
  let out = '', i = 0;
  const rowOf = (r) => mapRow(r) ?? r;
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"') {
      const j = f.indexOf('"', i + 1); let lit = f.slice(i, j + 1);
      const h = /^"#(\$?[A-Z]{1,3}\$?)(\d+)"$/.exec(lit);       // HYPERLINK("#A32") 같은 시트 안 이동
      if (h && mapRow(+h[2]) != null) lit = `"#${h[1]}${mapRow(+h[2])}"`;
      out += lit; i = j + 1; continue;
    }
    if (ch === "'") { const j = f.indexOf("'", i + 1); out += f.slice(i, j + 1); i = j + 1; continue; }
    const prev = out.length ? out[out.length - 1] : '';
    const m = REF.exec(f.slice(i));
    if (m && !/[A-Za-z0-9_.]/.test(prev)) {
      const other = prev === '!';
      let len = m[0].length;
      const m2 = f[i + len] === ':' ? REF.exec(f.slice(i + len + 1)) : null;
      if (other) { out += m[0]; if (m2) { out += ':' + m2[0]; len += 1 + m2[0].length; } i += len; continue; }
      const one = (mm, r) => mm[1] + mm[2] + mm[3] + (mm[3] ? r : rowOf(r));
      if (m2) {
        const r1 = +m[4], r2 = +m2[4];
        const c1 = colToNum(m[2]), c2 = colToNum(m2[2]);
        const split = r1 !== r2 && mapRow(r1) != null && mapRow(r2) != null && !m[3] && !m2[3];
        if (split) {
          const list = [];
          for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) list.push(numToCol(c) + rowOf(r));
          const chunks = []; for (let k = 0; k < list.length; k += 200) chunks.push(list.slice(k, k + 200).join(','));
          out += chunks.length > 1 ? chunks.map((c) => `SUM(${c})`).join(',') : chunks[0];
        } else out += one(m, r1) + ':' + one(m2, r2);
        i += len + 1 + m2[0].length; continue;
      }
      out += one(m, +m[4]); i += len; continue;
    }
    const w = /^[A-Za-z_][\w.]*/.exec(f.slice(i));
    if (w) { out += w[0]; i += w[0].length; continue; }
    out += ch; i++;
  }
  return out;
}

/** 시트 XML에서 행 속성 · 셀 스타일 · 병합 읽기 */
function sheetLayout(xml) {
  const rows = new Map(), styles = new Map();
  for (const m of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = +/\br="(\d+)"/.exec(m[1])[1];
    rows.set(r, m[1].replace(/\s*\br="\d+"/, '').replace(/\s*\bspans="[^"]*"/, ''));
    for (const c of (m[2] || '').matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>)/g)) styles.set(c[1], /\bs="(\d+)"/.exec(c[2])?.[1] || '0');
  }
  const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((m) => m[1]);
  return { rows, styles, merges };
}

/** 글자색만 바꾼 스타일을 만들어 주는 도구 (styles.xml) */
function styleTool(xml) {
  const fontsM = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(xml);
  const fonts = [...fontsM[1].matchAll(/<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/g)].map((m) => m[0]);
  const xfsM = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  const xfs = [...xfsM[1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map((m) => m[0]);
  const fontCache = new Map(), xfCache = new Map();
  const fontWith = (fid, argb) => {
    const k = fid + '|' + argb; if (fontCache.has(k)) return fontCache.get(k);
    let f = fonts[fid] || fonts[0];
    if (/^<font\b[^>]*\/>$/.test(f)) f = f.replace(/\/>$/, '></font>');
    f = f.replace(/<color\b[^>]*\/>/g, '');
    f = /<sz\b[^>]*\/>/.test(f) ? f.replace(/(<sz\b[^>]*\/>)/, `$1<color rgb="${argb}"/>`) : f.replace(/^(<font\b[^>]*>)/, `$1<color rgb="${argb}"/>`);
    fonts.push(f); const id = fonts.length - 1; fontCache.set(k, id); return id;
  };
  return {
    color(s, argb) {
      if (!argb) return s;
      const k = s + '|' + argb; if (xfCache.has(k)) return xfCache.get(k);
      const xf = xfs[+s] || xfs[0];
      const fid = +(/fontId="(\d+)"/.exec(xf)?.[1] || 0);
      let nx = xf.replace(/\s*fontId="\d+"/, '').replace(/\s*applyFont="\d+"/, '').replace(/^<xf\b/, `<xf fontId="${fontWith(fid, argb)}" applyFont="1"`);
      xfs.push(nx); const id = String(xfs.length - 1); xfCache.set(k, id); return id;
    },
    xml() {
      return xml
        .replace(/<fonts\b([^>]*)>[\s\S]*?<\/fonts>/, (m, a) => `<fonts${a.replace(/count="\d+"/, `count="${fonts.length}"`)}>${fonts.join('')}</fonts>`)
        .replace(/<cellXfs\b([^>]*)>[\s\S]*?<\/cellXfs>/, (m, a) => `<cellXfs${a.replace(/count="\d+"/, `count="${xfs.length}"`)}>${xfs.join('')}</cellXfs>`);
    },
  };
}

/**
 * opt: { sheet, headerRow, mode: 'pair'|'single', outName, title,
 *        rule: { top: 'change'|'orig', orig_color, chg_color, merge_text },
 *        edits: { [기준행]: { qty?, mat_price?, lab_price?, exp_price? } },
 *        newItems: [{ id, parent_row, after_row?, name, spec, unit, qty, mat_price, lab_price, exp_price, note, unit_cost_id? }],
 *        unitCosts: 신규 일위대가 [{ id, seq, name, spec, unit, basis, apply_rate, lines: [{ name, spec, unit, qty, mat|lab|exp: { v?, f?, quote? }, src }] }],
 *        quotes: 단가산출서 [{ id, seq, name, spec, unit, sources: [{ label, price, ref }], method: min|avg|pick, pick }], rate: 낙찰률 }
 *  edits[행].unit_cost_id / 신규 항목 unit_cost_id 가 있으면 변경 단가 = '신규 일위대가' 시트의 적용 단가 칸 수식
 */
export async function buildChange(buf, opt) {
  const { sheet, headerRow, mode = 'pair', rule = {}, edits = {}, newItems = [], unitCosts = [], quotes = [], rate = null } = opt;
  const pair = mode === 'pair';
  const topIsChange = (rule.top || 'change') === 'change';
  const merge = pair && rule.merge_text !== false;
  const origArgb = COLORS[rule.orig_color || 'black'], chgArgb = COLORS[rule.chg_color || 'red'];

  const zip = await JSZip.loadAsync(buf);
  const model = await readWorkbook(buf);
  const ev = new Evaluator(model);
  const P = parseBoq(model, ev, sheet, headerRow);
  const { cm, items } = P;
  const byRow = new Map(items.map((i) => [i.row, i]));
  const files = await sheetFiles(zip);
  const baseFile = files.find((f) => f.name === sheet);
  let baseXml = await zip.file(baseFile.path).async('string');
  const lay = sheetLayout(baseXml);
  const base = model.sheet(sheet);
  let maxRow = 0, maxCol = 0;
  for (const a of [...base.cells.keys(), ...lay.styles.keys()]) { const { row, col } = splitAddr(a); maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col); }
  for (const r of lay.rows.keys()) maxRow = Math.max(maxRow, r);
  const first = cm.firstRow;
  let outName = opt.outName || (pair ? '변경내역서' : '준공내역서');
  for (let k = 2; files.some((f) => f.name === outName); k++) outName = (opt.outName || (pair ? '변경내역서' : '준공내역서')) + ` (${k})`;

  // 신규 항목 검사 · 넣을 위치 (부모 묶음의 마지막 하위 행 다음)
  const descLast = (p) => { let last = p; for (const it of items) { let x = it, d = 0; while (x && d < 30) { if (x.parent_row === p) { last = Math.max(last, it.row); break; } x = byRow.get(x.parent_row); d++; } } return last; };
  for (const ni of newItems) {
    const par = byRow.get(+ni.parent_row);
    if (!par || par.kind !== 'group') throw new Error(`신규 항목 '${ni.name}': 들어갈 공종 묶음을 고르세요`);
    ni.parent_row = +ni.parent_row; ni.after = ni.after_row ? +ni.after_row : descLast(ni.parent_row);
  }

  // 1) 행 배치
  const O = new Map(), C = new Map(), NO = new Map(), NC = new Map();
  let cur = first;
  const place = (setO, setC, key) => {
    if (pair) { const t = cur, b = cur + 1; cur += 2; setC.set(key, topIsChange ? t : b); setO.set(key, topIsChange ? b : t); }
    else { setC.set(key, cur); cur += 1; }
  };
  for (let r = first; r <= maxRow; r++) {
    place(O, C, r);
    for (const ni of newItems.filter((x) => x.after === r)) place(NO, NC, ni);
  }
  const lastRow = cur - 1;
  const inData = (r) => r >= first && r <= maxRow;
  const mapC = (r) => (inData(r) ? C.get(r) : null);
  const mapO = (r) => (inData(r) ? O.get(r) : null);
  const localize = (f) => f.replace(new RegExp(`'${esc(sheet)}'!|(?<![\\w가-힣'])${esc(sheet)}!`, 'g'), '');

  const st = styleTool(await zip.file('xl/styles.xml').async('string'));
  const cells = new Map();   // addr → { v?, f?, s }
  const rowAttr = new Map();
  const put = (a, x) => cells.set(a, { ...(cells.get(a) || {}), ...x });
  const textCols = new Set([cm.name, cm.spec, cm.unit].filter(Boolean));
  const priceCols = ['mat', 'lab', 'exp'].map((k) => cm[k + 'Price']).filter(Boolean);
  const amtCols = ['mat', 'lab', 'exp'].map((k) => cm[k + 'Amt']).filter(Boolean);
  const keyOf = { [cm.matPrice]: 'mat_price', [cm.labPrice]: 'lab_price', [cm.expPrice]: 'exp_price' };
  const evv = (a) => ev.value(sheet, a);

  // 2) 머리글 행: 그대로
  for (let r = 1; r < first; r++) {
    if (lay.rows.has(r)) rowAttr.set(r, lay.rows.get(r));
    for (let c = 1; c <= maxCol; c++) {
      const a = numToCol(c) + r; const x = base.cells.get(a); const s = lay.styles.get(a);
      if (!x && s == null) continue;
      put(a, { s: s ?? '0', ...(x?.f ? { f: remapFormula(localize(x.f), mapC) } : { v: x?.v ?? null }) });
    }
  }
  const t1 = opt.title || (pair ? '변 경 내 역 서' : '준 공 내 역 서');
  const a1 = base.cells.get('A1')?.v;
  if (typeof a1 === 'string' && /내\s*역\s*서/.test(a1)) put('A1', { v: t1, f: undefined });

  // 2-1) 신규 일위대가 · 단가산출서 시트 (새 시트, 내역서의 변경 단가가 여기를 가리킴)
  const taken = new Set([...files.map((f) => f.name), outName]);
  const uniq = (nm) => { let x = nm; for (let k = 2; taken.has(x); k++) x = `${nm} (${k})`; taken.add(x); return x; };
  // 일위대가 줄의 단가 수식은 '다른 시트 칸 하나'만 허용 (자재!D5 같은)
  for (const uc of unitCosts) for (const ln of uc.lines || []) for (const k of ['mat', 'lab', 'exp']) {
    const pv = ln[k]; if (!pv?.f) continue;
    const ref = parseSheetRef(pv.f);
    if (!ref || !files.some((f) => f.name === ref.sheet)) throw new Error(`일위대가 '${uc.name}'의 '${ln.name}' 단가 출처를 찾을 수 없습니다 (${pv.f})`);
    pv.f = sheetRef(ref.sheet, ref.a);
  }
  const ucName = unitCosts.length ? uniq('신규 일위대가') : null;
  const qsName = quotes.length ? uniq('신규 단가산출') : null;
  const tplItem = items.find((x) => x.kind === 'item')?.row ?? first;
  const tplGroup = items.find((x) => x.kind === 'group')?.row ?? tplItem;
  const S = (col, r) => lay.styles.get(col + r) ?? '0';
  const sty = {
    title: S('A', 1), hdr: S(cm.name, headerRow), hdrN: S(cm.matPrice || cm.qty, headerRow),
    text: S(cm.name, tplItem), spec: S(cm.spec || cm.name, tplItem), qty: S(cm.qty, tplItem), unit: S(cm.unit, tplItem), price: S(cm.matPrice || cm.qty, tplItem), amt: S(cm.matAmt || cm.qty, tplItem),
    gText: S(cm.name, tplGroup), gAmt: S(cm.matAmt || cm.qty, tplGroup), note: S(cm.note || cm.name, tplItem),
  };
  const qref = (nm) => `'${nm.replace(/'/g, "''")}'!`;
  const qsCells = new Map(), qRow = new Map();
  if (qsName) {
    qsCells.set('A1', { v: '신 규 단 가 산 출 서', s: sty.title });
    ['품    명', '규    격', '단 위', '물가정보', '거래가격', '견    적', '적용기준', '적용단가', '출처 · 비고'].forEach((h, i) => qsCells.set(numToCol(i + 1) + 2, { v: h, s: i >= 3 && i <= 7 ? sty.hdrN : sty.hdr }));
    quotes.forEach((qt, i) => {
      const r = 3 + i; qRow.set(qt.id, r);
      qsCells.set('A' + r, { v: qt.name, s: sty.text }); qsCells.set('B' + r, { v: qt.spec || null, s: sty.spec }); qsCells.set('C' + r, { v: qt.unit || null, s: sty.unit });
      ['D', 'E', 'F'].forEach((c, k) => { const v = qt.sources?.[k]?.price; qsCells.set(c + r, { v: v === null || v === undefined || v === '' ? null : Number(v), s: sty.price }); });
      const m = qt.method === 'avg' ? '평균' : qt.method === 'pick' ? '직접 선택' : '최저가';
      qsCells.set('G' + r, { v: m, s: sty.unit });
      const f = qt.method === 'avg' ? `IF(COUNT(D${r}:F${r})=0,0,TRUNC(AVERAGE(D${r}:F${r}),0))` : qt.method === 'pick' ? `${'DEF'[Math.min(2, Math.max(0, qt.pick || 0))]}${r}` : `MIN(D${r}:F${r})`;
      qsCells.set('H' + r, { f, s: sty.price });
      qsCells.set('I' + r, { v: (qt.sources || []).map((x, k) => (x?.ref ? `${['물가정보', '거래가격', '견적'][k]}: ${x.ref}` : '')).filter(Boolean).join(' / ') || null, s: sty.note });
    });
  }
  const ucCells = new Map(), ucTarget = new Map();
  let ucLast = 3;
  if (ucName) {
    ucCells.set('A1', { v: '신 규 일 위 대 가', s: sty.title });
    ucCells.set('K1', { v: '낙찰률', s: sty.hdr }); ucCells.set('L1', { v: rate || 1, s: sty.price });
    ['공 종 명', '규    격', '수 량', '단 위', '합계 단가', '합계 금액', '재료비 단가', '재료비 금액', '노무비 단가', '노무비 금액', '경비 단가', '경비 금액', '비    고'].forEach((h, i) => ucCells.set(numToCol(i + 1) + 2, { v: h, s: i >= 2 && i <= 11 ? sty.hdrN : sty.hdr }));
    let r = 4;
    for (const uc of unitCosts) {
      const h = r; const lines = uc.lines || [];
      const L = lines.map((_, k) => h + 1 + k);
      const sum = (col) => (L.length ? `TRUNC(${L.map((x) => col + x).join('+')},0)` : '0');
      ucCells.set('A' + h, { v: `신규 ${uc.seq}  ${uc.name}`, s: sty.gText }); ucCells.set('B' + h, { v: uc.spec || null, s: sty.spec });
      ucCells.set('C' + h, { v: 1, s: sty.qty }); ucCells.set('D' + h, { v: uc.unit || null, s: sty.unit });
      for (const c of ['H', 'J', 'L']) ucCells.set(c + h, { f: sum(c), s: sty.gAmt });
      ucCells.set('F' + h, { f: `H${h}+J${h}+L${h}`, s: sty.gAmt });
      ucCells.set('M' + h, { v: uc.basis || null, s: sty.note });
      lines.forEach((ln, k) => {
        const x = L[k];
        ucCells.set('A' + x, { v: ln.name || '', s: sty.text }); ucCells.set('B' + x, { v: ln.spec || null, s: sty.spec });
        ucCells.set('C' + x, { v: Number(ln.qty) || 0, s: sty.qty }); ucCells.set('D' + x, { v: ln.unit || null, s: sty.unit });
        [['G', 'mat'], ['I', 'lab'], ['K', 'exp']].forEach(([c, key]) => {
          const pv = ln[key] || {};
          const cell = pv.quote && qRow.has(pv.quote) ? { f: `${qref(qsName)}H${qRow.get(pv.quote)}` } : pv.f ? { f: pv.f } : { v: Number(pv.v) || 0 };
          ucCells.set(c + x, { ...cell, s: sty.price });
        });
        ucCells.set('H' + x, { f: `TRUNC(G${x}*C${x},0)`, s: sty.amt }); ucCells.set('J' + x, { f: `TRUNC(I${x}*C${x},0)`, s: sty.amt }); ucCells.set('L' + x, { f: `TRUNC(K${x}*C${x},0)`, s: sty.amt });
        ucCells.set('E' + x, { f: `G${x}+I${x}+K${x}`, s: sty.price }); ucCells.set('F' + x, { f: `H${x}+J${x}+L${x}`, s: sty.amt });
        ucCells.set('M' + x, { v: ln.src || null, s: sty.note });
      });
      const a = h + 1 + lines.length;
      const useRate = uc.apply_rate !== false && rate;
      ucCells.set('A' + a, { v: useRate ? '  적용 단가 (낙찰률 적용)' : '  적용 단가', s: sty.text });
      ucCells.set('C' + a, { v: 1, s: sty.qty }); ucCells.set('D' + a, { v: uc.unit || null, s: sty.unit });
      [['G', 'H'], ['I', 'J'], ['K', 'L']].forEach(([pc, ac]) => ucCells.set(pc + a, { f: useRate ? `TRUNC(${ac}${h}*$L$1,0)` : `${ac}${h}`, s: sty.price }));
      ucCells.set('E' + a, { f: `G${a}+I${a}+K${a}`, s: sty.price });
      ucTarget.set(uc.id, a);
      r = a + 2; ucLast = a;
    }
  }
  const linked = new Set();
  const linkKey = { [cm.matPrice]: 'G', [cm.labPrice]: 'I', [cm.expPrice]: 'K' };
  const linkPrice = (pc, row, ucId) => { put(pc + row, { v: undefined, f: `${qref(ucName)}${linkKey[pc]}${ucTarget.get(ucId)}` }); linked.add(pc + row); };
  const hasUc = (id) => id && ucName && ucTarget.has(id);

  // 3) 기준 행 → 당초 / 변경 줄
  let labeled = false;
  for (let r = first; r <= maxRow; r++) {
    const it = byRow.get(r);
    const e = edits[r] || {};
    const variants = pair ? [['C', C.get(r), mapC, chgArgb], ['O', O.get(r), mapO, origArgb]] : [['C', C.get(r), mapC, null]];
    const topRow = pair ? Math.min(C.get(r), O.get(r)) : C.get(r);
    for (const [V, nr, mp, argb] of variants) {
      if (lay.rows.has(r)) rowAttr.set(nr, lay.rows.get(r));
      for (let c = 1; c <= maxCol; c++) {
        const col = numToCol(c), a = col + r, na = col + nr;
        const x = base.cells.get(a); const s0 = lay.styles.get(a);
        if (!x && s0 == null) continue;
        const s = st.color(s0 ?? '0', argb);
        if (merge && textCols.has(col) && nr !== topRow) { put(na, { s, v: null }); continue; }
        if (x?.f) put(na, { s, f: remapFormula(localize(x.f), mp) });
        else put(na, { s, v: x?.v ?? null });
      }
      if (it?.kind === 'item') {
        const q = cm.qty + nr;
        if (V === 'O') {
          put(q, { f: undefined, v: evv(cm.qty + r) });
          for (const pc of priceCols) put(pc + nr, { f: undefined, v: evv(pc + r) ?? 0 });
        } else {
          if (e.qty !== undefined && e.qty !== null && e.qty !== '') put(q, { f: undefined, v: Number(e.qty) });
          else if (!pair || !base.cells.get(cm.qty + r)?.f) put(q, { f: undefined, v: evv(cm.qty + r) });
          for (const pc of priceCols) {
            const ek = e[keyOf[pc]];
            if (hasUc(e.unit_cost_id)) linkPrice(pc, nr, e.unit_cost_id);
            else if (ek !== undefined && ek !== null && ek !== '') put(pc + nr, { f: undefined, v: Math.trunc(Number(ek)) });
            else if (pair) put(pc + nr, { v: undefined, f: pc + O.get(r) });
            else put(pc + nr, { f: undefined, v: evv(pc + r) ?? 0 });
          }
        }
      }
    }
    if (pair && !labeled && it && cm.note) {
      const nc = cm.note;
      if (!base.cells.get(nc + r)?.v) { put(nc + C.get(r), { v: '변경', f: undefined }); put(nc + O.get(r), { v: '당초', f: undefined }); labeled = true; }
    }
  }

  // 4) 신규 항목
  const fillNew = (ni) => {
    const sibs = items.filter((x) => x.parent_row === ni.parent_row && x.kind === 'item');
    const tpl = (sibs[0] || items.find((x) => x.kind === 'item')).row;
    const nr = NC.get(ni), nro = NO.get(ni);
    const tplLead = (String(base.cells.get(cm.name + tpl)?.v ?? '').match(/^\s*/) || [''])[0];
    const formCols = new Set([...amtCols, cm.totalAmt, cm.totalPrice].filter(Boolean));
    for (const [row, argb, isC] of pair ? [[nr, chgArgb, true], [nro, origArgb, false]] : [[nr, null, true]]) {
      if (lay.rows.has(tpl)) rowAttr.set(row, lay.rows.get(tpl));
      const topRow = pair ? Math.min(nr, nro) : nr;
      for (let c = 1; c <= maxCol; c++) {
        const col = numToCol(c); const s0 = lay.styles.get(col + tpl);
        if (s0 == null && !base.cells.get(col + tpl)) continue;
        const s = st.color(s0 ?? '0', argb);
        const x = base.cells.get(col + tpl);
        let cell = { s, v: null };
        const showText = !merge || row === topRow;
        if (col === cm.name && showText) cell.v = tplLead + ni.name;
        else if (col === cm.spec && showText) cell.v = ni.spec || null;
        else if (col === cm.unit && showText) cell.v = ni.unit || null;
        else if (col === cm.note && isC) cell.v = ni.note || '신규';
        else if (isC && col === cm.qty) cell.v = Number(ni.qty) || 0;
        else if (isC && priceCols.includes(col) && hasUc(ni.unit_cost_id)) { cell = { s, f: `${qref(ucName)}${linkKey[col]}${ucTarget.get(ni.unit_cost_id)}` }; linked.add(col + row); }
        else if (isC && priceCols.includes(col)) cell.v = Math.trunc(Number(ni[keyOf[col]]) || 0);
        else if (isC && formCols.has(col) && x?.f) cell = { s, f: remapFormula(localize(x.f), (rr) => (rr === tpl ? nr : mapC(rr))) };
        put(col + row, cell);
      }
    }
  };
  newItems.forEach(fillNew);
  // 소계에 신규 행 더하기: 부모 묶음 + 형제 공종을 직접 더하는 위쪽 소계
  for (const ni of newItems) {
    const sib = new Set(items.filter((x) => x.parent_row === ni.parent_row).map((x) => x.row));
    for (const g of items.filter((x) => x.kind === 'group' && (x.row === ni.parent_row || x.children.some((c) => sib.has(c))))) {
      for (const col of amtCols) {
        const a = col + C.get(g.row); const cx = cells.get(a);
        if (cx?.f) cx.f = `${cx.f}+${col}${NC.get(ni)}`;
      }
    }
  }

  // 5) 병합
  const merges = [], covered = new Set();
  const addMerge = (c1, r1, c2, r2) => {
    if (c1 === c2 && r1 === r2) return;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (covered.has(c + ':' + r)) return;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) covered.add(c + ':' + r);
    merges.push(`${numToCol(c1)}${r1}:${numToCol(c2)}${r2}`);
  };
  for (const ref of lay.merges) {
    const [p, q] = ref.split(':').map(splitAddr);
    if (q.row < first) { addMerge(p.col, p.row, q.col, q.row); continue; }
    if (!inData(p.row) || !inData(q.row)) continue;
    if (!pair) { addMerge(p.col, C.get(p.row), q.col, C.get(q.row)); continue; }
    const hasText = [...textCols].some((t) => colToNum(t) >= p.col && colToNum(t) <= q.col);
    if (p.row === q.row && !(merge && hasText)) {
      addMerge(p.col, C.get(p.row), q.col, C.get(p.row)); addMerge(p.col, O.get(p.row), q.col, O.get(p.row));
    } else addMerge(p.col, Math.min(C.get(p.row), O.get(p.row)), q.col, Math.max(C.get(q.row), O.get(q.row)));
  }
  if (merge) {
    const pairs = [...[...C.keys()].map((r) => [C.get(r), O.get(r), byRow.has(r) || base.cells.get(cm.name + r)]), ...newItems.map((ni) => [NC.get(ni), NO.get(ni), true])];
    for (const [a, b, has] of pairs) if (has) for (const t of textCols) addMerge(colToNum(t), Math.min(a, b), colToNum(t), Math.max(a, b));
  }

  // 6) 계산 (새 시트를 모델에 넣고 엑셀과 같은 계산기로)
  const toModel = (cs) => { const m = new Map(); for (const [a, x] of cs) if (x.f || (x.v !== null && x.v !== undefined)) m.set(a, { v: x.v ?? null, f: x.f || null }); return m; };
  if (qsName) model.sheets.push({ name: qsName, path: null, cells: toModel(qsCells) });
  if (ucName) model.sheets.push({ name: ucName, path: null, cells: toModel(ucCells) });
  for (const [nm, cs] of [[qsName, qsCells], [ucName, ucCells]]) if (nm) for (const [a, x] of cs) if (x.f) { const v = ev.value(nm, a); x.v = typeof v === 'number' ? clean(v) : v; }
  const sheetCells = new Map();
  for (const [a, x] of cells) if (x.f || (x.v !== null && x.v !== undefined)) sheetCells.set(a, { v: x.v ?? null, f: x.f || null });
  model.sheets.push({ name: outName, path: null, cells: sheetCells });
  for (const [a, x] of cells) if (x.f) { const v = ev.value(outName, a); x.v = typeof v === 'number' ? clean(v) : v; }
  // 준공내역서(한 줄)는 단가를 값으로: 일위대가에 연결된 단가도 계산값으로 바꿈
  if (!pair) for (const a of linked) { const x = cells.get(a); x.f = undefined; sheetCells.get(a).f = null; }

  // 7) 결과 정리
  const n = (col, row) => { if (!col || row == null) return null; const v = ev.value(outName, col + row); return typeof v === 'number' ? clean(v) : null; };
  const pack = (row) => {
    const o = { qty: n(cm.qty, row), mat_price: n(cm.matPrice, row), lab_price: n(cm.labPrice, row), exp_price: n(cm.expPrice, row),
      mat_amt: n(cm.matAmt, row) || 0, lab_amt: n(cm.labAmt, row) || 0, exp_amt: n(cm.expAmt, row) || 0 };
    o.total_amt = o.mat_amt + o.lab_amt + o.exp_amt; return o;
  };
  const out = [];
  for (const it of items) {
    const c = pack(C.get(it.row)), o = pair ? pack(O.get(it.row)) : null;
    const ch = !o ? null : it.kind !== 'item' ? (c.total_amt !== o.total_amt ? 'amt' : 'same')
      : (c.qty === 0 && o.qty) ? 'del' : ['mat_price', 'lab_price', 'exp_price'].some((k) => c[k] !== o[k]) ? 'price' : c.qty !== o.qty ? 'qty' : 'same';
    out.push({ ...it, ...c, orig: o, change: ch, xl_row: C.get(it.row) });
  }
  newItems.forEach((ni, k) => {
    const c = pack(NC.get(ni)); const par = byRow.get(ni.parent_row);
    out.push({ row: 100000 + k, new_id: ni.id || String(k), kind: 'item', section: 'detail', name: ni.name, spec: ni.spec || '', unit: ni.unit || '', note: ni.note || '신규',
      parent_row: ni.parent_row, level: (par?.level ?? 0) + 1, after_row: ni.after, ...c, orig: pair ? { qty: null, total_amt: 0 } : null, change: pair ? 'new' : null, xl_row: NC.get(ni) });
  });
  const totals = {}, origTotals = {};
  for (const [k, v] of Object.entries(P.totals)) if (v) { totals[k] = pack(C.get(v.row)).total_amt; if (pair) origTotals[k] = pack(O.get(v.row)).total_amt; }

  // 확정 전 검사
  const checks = [];
  const badNew = newItems.filter((ni) => !(Number(ni.qty) > 0) || !(hasUc(ni.unit_cost_id) || ['mat_price', 'lab_price', 'exp_price'].some((k) => Number(ni[k]) > 0)));
  checks.push({ label: '신규 항목에 수량 · 단가가 모두 있음', ok: !badNew.length, detail: badNew.map((x) => x.name).join(', ') });
  const nonInt = out.filter((x) => [x.mat_amt, x.lab_amt, x.exp_amt].some((v) => !Number.isInteger(v)));
  checks.push({ label: '모든 금액이 원 단위 정수 (TRUNC)', ok: !nonInt.length, detail: nonInt.slice(0, 5).map((x) => x.name).join(', ') });
  const noQty = out.filter((x) => x.kind === 'item' && x.qty == null);
  checks.push({ label: '비어 있는 수량 없음', ok: !noQty.length, detail: noQty.slice(0, 5).map((x) => x.name).join(', ') });
  if (pair) {
    const linked = items.filter((x) => x.kind === 'item').length;
    checks.push({ label: `변경 단가가 당초 단가 칸이나 입력값에 연결됨 (${linked}개 항목)`, ok: true, detail: '' });
  }
  const direct = newItems.filter((ni) => !hasUc(ni.unit_cost_id));
  if (pair) checks.push({ label: '신규 단가가 일위대가 · 단가산출서에 연결됨', ok: !direct.length, warn: true, detail: direct.length ? `직접 입력 ${direct.length}개: ${direct.slice(0, 5).map((x) => x.name).join(', ')}` : '' });
  const ucZero = unitCosts.filter((uc) => !(uc.lines || []).length);
  if (ucZero.length) checks.push({ label: '신규 일위대가에 내용이 있음', ok: false, detail: ucZero.map((x) => x.name).join(', ') });
  const sumCheck = totals.contract == null || Number.isInteger(totals.contract);
  checks.push({ label: '원가계산서 다시 계산 완료', ok: sumCheck, detail: '' });

  // 8) 파일 만들기
  const makeFile = async () => {
    const z = await JSZip.loadAsync(buf);
    z.file('xl/styles.xml', st.xml());
    // 새 시트 XML (기준 시트의 열 너비 · 틀 고정 · 인쇄 설정을 이어받음)
    const head = baseXml.slice(0, baseXml.indexOf('<sheetData'));
    let tail = baseXml.slice(baseXml.indexOf('</sheetData>') + '</sheetData>'.length);
    for (const tag of ['mergeCells', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'rowBreaks', 'colBreaks', 'autoFilter', 'sheetProtection', 'protectedRanges', 'tableParts', 'oleObjects', 'controls', 'extLst', 'sortState', 'ignoredErrors'])
      tail = tail.replace(new RegExp(`<${tag}\\b[^>]*/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g'), '');
    tail = tail.replace(/<(drawing|legacyDrawing|legacyDrawingHF|picture)\b[^>]*\/>/g, '').replace(/\s*r:id="[^"]*"/g, '');
    const mc = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    const anchor = /<(phoneticPr|printOptions|pageMargins|pageSetup|headerFooter)\b/.exec(tail);
    tail = anchor ? tail.slice(0, anchor.index) + mc + tail.slice(anchor.index) : tail.replace('</worksheet>', mc + '</worksheet>');
    let h = head.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${numToCol(maxCol)}${lastRow}"/>`)
      .replace(/\s*codeName="[^"]*"/, '').replace(/\s*tabSelected="1"/g, '').replace(/<sheetView\b/, '<sheetView tabSelected="1"');
    const rowsXml = [];
    const byR = new Map();
    for (const [a, x] of cells) { const { row, col } = splitAddr(a); if (!byR.has(row)) byR.set(row, []); byR.get(row).push([col, a, x]); }
    for (const r of [...new Set([...byR.keys(), ...rowAttr.keys()])].sort((p, q) => p - q)) {
      const cs = (byR.get(r) || []).sort((p, q) => p[0] - q[0]).map(([, a, x]) => cellXml(a, x)).join('');
      rowsXml.push(`<row r="${r}"${rowAttr.get(r) || ''}>${cs}</row>`);
    }
    // 시트 파일 · 관계 · 형식 등록
    const addSheet = async (xml) => {
      let num = 1; while (z.file(`xl/worksheets/sheet${num}.xml`)) num++;
      const path = `xl/worksheets/sheet${num}.xml`;
      z.file(path, xml);
      const relsP = 'xl/_rels/workbook.xml.rels';
      let rels = await z.file(relsP).async('string');
      let rid = 'rIdGm1'; for (let k = 1; rels.includes(`Id="${rid}"`); k++) rid = 'rIdGm' + k;
      rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${num}.xml"/></Relationships>`);
      z.file(relsP, rels);
      let ct = await z.file('[Content_Types].xml').async('string');
      ct = ct.replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
      z.file('[Content_Types].xml', ct);
      return rid;
    };
    const rid = await addSheet(h + `<sheetData>${rowsXml.join('')}</sheetData>` + tail);
    const cols = (/<cols>[\s\S]*?<\/cols>/.exec(baseXml) || [''])[0];
    const simpleSheet = (cs, lastCol, lastR, widths) => {
      const byRow = new Map();
      for (const [a, x] of cs) { const { row, col } = splitAddr(a); if (!byRow.has(row)) byRow.set(row, []); byRow.get(row).push([col, a, x]); }
      const rx = [...byRow.keys()].sort((p, q) => p - q).map((r) => `<row r="${r}">${byRow.get(r).sort((p, q) => p[0] - q[0]).map(([, a, x]) => cellXml(a, x)).join('')}</row>`).join('');
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
        + `<dimension ref="A1:${lastCol}${lastR}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>`
        + (widths || cols) + `<sheetData>${rx}</sheetData><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape"/></worksheet>`;
    };
    const extra = [];
    if (ucName) extra.push([ucName, await addSheet(simpleSheet(ucCells, 'M', ucLast, cols))]);
    if (qsName) extra.push([qsName, await addSheet(simpleSheet(qsCells, 'I', 2 + quotes.length, '<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="7" customWidth="1"/><col min="4" max="8" width="13" customWidth="1"/><col min="9" max="9" width="40" customWidth="1"/></cols>'))]);
    // workbook.xml: 기준 시트 앞에 넣고, 기준 시트는 숨김, 새 시트를 열린 시트로
    let wb = await z.file('xl/workbook.xml').async('string');
    const sheetTags = [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0]);
    const baseIdx = sheetTags.findIndex((t) => decode(/name="([^"]*)"/.exec(t)[1]) === sheet);
    const maxId = Math.max(...sheetTags.map((t) => +/sheetId="(\d+)"/.exec(t)[1]));
    const tagOf = (nm, id, r) => `<sheet name="${encode(nm).replace(/"/g, '&quot;')}" sheetId="${id}" r:id="${r}"/>`;
    const newTag = tagOf(outName, maxId + 1, rid) + extra.map(([nm, r], k) => tagOf(nm, maxId + 2 + k, r)).join('');
    const ins = 1 + extra.length;
    const baseTag = sheetTags[baseIdx];
    const hiddenBase = /state="/.test(baseTag) ? baseTag.replace(/state="[^"]*"/, 'state="hidden"') : baseTag.replace(/\/>$/, ' state="hidden"/>');
    wb = wb.replace(baseTag, newTag + hiddenBase);
    wb = wb.replace(/localSheetId="(\d+)"/g, (m, k) => `localSheetId="${+k >= baseIdx ? +k + ins : k}"`);
    const pt = [...wb.matchAll(/<definedName\b[^>]*name="_xlnm\.Print_Titles"[^>]*localSheetId="(\d+)"[^>]*>([\s\S]*?)<\/definedName>/g)].find((m) => +m[1] === baseIdx + ins);
    if (pt) {
      const txt = pt[2].replace(new RegExp(`'?${esc(encode(sheet))}'?!`, 'g'), `'${encode(outName)}'!`);
      wb = wb.replace(pt[0], pt[0] + `<definedName name="_xlnm.Print_Titles" localSheetId="${baseIdx}">${txt}</definedName>`);
    }
    wb = /activeTab="/.test(wb) ? wb.replace(/activeTab="\d+"/, `activeTab="${baseIdx}"`) : wb.replace(/<workbookView\b/, `<workbookView activeTab="${baseIdx}"`);
    wb = wb.replace(/firstSheet="\d+"/, 'firstSheet="0"');
    z.file('xl/workbook.xml', wb);
    for (const f of files) { const x = await z.file(f.path).async('string'); if (/tabSelected="1"/.test(x)) z.file(f.path, x.replace(/\s*tabSelected="1"/g, '')); }
    await finishZip(z);
    return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };

  const ucPrices = {};
  if (ucName) for (const [id, a] of ucTarget) ucPrices[id] = { mat: ev.num(ucName, 'G' + a), lab: ev.num(ucName, 'I' + a), exp: ev.num(ucName, 'K' + a) };
  return { outName, cm, items: out, totals, origTotals, checks, ucPrices, ucName, qsName, rows: { first, last: lastRow }, model, ev, makeFile,
    parseOut: () => parseBoq(model, ev, outName, headerRow) };
}

function cellXml(a, x) {
  const s = x.s && x.s !== '0' ? ` s="${x.s}"` : '';
  if (x.f) {
    const v = x.v;
    const t = typeof v === 'string' ? ' t="str"' : typeof v === 'boolean' ? ' t="b"' : '';
    const vv = v === null || v === undefined ? '' : `<v>${typeof v === 'boolean' ? (v ? 1 : 0) : encode(v)}</v>`;
    return `<c r="${a}"${s}${t}><f>${encode(x.f)}</f>${vv}</c>`;
  }
  const v = x.v;
  if (v === null || v === undefined || v === '') return `<c r="${a}"${s}/>`;
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${a}"${s}><v>${v}</v></c>` : `<c r="${a}"${s}/>`;
  if (typeof v === 'boolean') return `<c r="${a}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${a}"${s} t="inlineStr"><is><t xml:space="preserve">${encode(v)}</t></is></c>`;
}
