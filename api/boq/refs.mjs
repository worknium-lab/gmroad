// 일위대가 작성용 단가 자료 모으기 (기준 엑셀 안의 시트에서)
//  - list  : 자재 · 노임처럼 '명칭 · 규격 · 단위 · 단가' 한 줄 표  → 단가 칸 하나를 가리킴
//  - triple: 일위대가목록 · 중기사용료목록 · 경비처럼 재료비 · 노무비 · 경비 열이 있는 한 줄 표 → 세 칸을 가리킴
//  - block : 일위대가_호표처럼 내역서 모양(단가 · 금액 두 줄 머리글)으로 호표마다 묶인 표 → 복사해서 고치기용
import { addr, numToCol } from './xlsx.mjs';
import { columnMap, parseBoq } from './detect.mjs';

const norm = (s) => String(s ?? '').replace(/\s+/g, '');
export const sheetRef = (sheet, a) => `'${sheet.replace(/'/g, "''")}'!${a}`;
const SINGLE_REF = /^(?:'((?:[^']|'')+)'|([^\s'!()+\-*/,&=<>^"]+))!\$?([A-Z]{1,3})\$?(\d+)$/;

/** 다른 시트 칸 하나만 가리키는 수식인지 → { sheet, a } */
export function parseSheetRef(f) {
  const m = SINGLE_REF.exec(String(f || '').trim().replace(/^=/, ''));
  return m ? { sheet: (m[1] ?? m[2]).replace(/''/g, "'"), a: m[3] + m[4] } : null;
}

export function collectRefs(model, ev, skip = []) {
  const prices = [], blocks = [];
  const num = (sheet, a) => { const v = ev.value(sheet, a); return typeof v === 'number' ? Math.round(v * 1000) / 1000 : null; };
  const txt = (sheet, a) => { const v = model.sheet(sheet).cells.get(a)?.v; return v == null ? '' : String(v).trim(); };
  for (const s of model.sheets) {
    if (skip.includes(s.name) || !s.cells.size) continue;
    let maxRow = 0; for (const a of s.cells.keys()) maxRow = Math.max(maxRow, +a.replace(/^[A-Z]+/, ''));
    for (let hr = 1; hr <= 8; hr++) {
      const head = {};
      for (let c = 1; c <= 30; c++) { const v = norm(s.cells.get(addr(c, hr))?.v); if (v) head[c] = v; }
      const find = (re) => +(Object.entries(head).find(([, v]) => re.test(v))?.[0] || 0);
      const cName = find(/^(명칭|품명|공종명|공종|품명및규격)$/), cSpec = find(/^규격$/), cUnit = find(/^단위$/);
      const cMat = find(/^재료비$/), cLab = find(/^노무비$/), cExp = find(/^경비$/), cPrice = find(/^단가$/);
      if (!cName || !cUnit) continue;
      const sub = (c) => norm(s.cells.get(addr(c, hr + 1))?.v);
      if (cMat && cLab && cExp && /단가|금액/.test(sub(cMat))) {
        if (!/호표|일위|대가|산근|산출/.test(s.name)) break;   // 내역서 · 변경내역서 같은 큰 표는 빼기
        // 호표 묶음 (내역서 모양)
        const cm = columnMap(model, s.name, hr);
        const P = parseBoq(model, ev, s.name, hr);
        for (const g of P.items.filter((x) => x.kind === 'group' && x.name)) {
          const kids = P.items.filter((x) => x.parent_row === g.row);
          if (!kids.length) continue;
          const price = (col, r) => {
            const f = s.cells.get(col + r)?.f; const ref = f && parseSheetRef(f);
            return ref && ref.sheet !== s.name ? { f: sheetRef(ref.sheet, ref.a), v: num(s.name, col + r) } : { v: num(s.name, col + r) || 0 };
          };
          const lines = kids.map((k) => k.kind === 'item'
            ? { name: k.name, spec: k.spec, unit: k.unit, qty: k.qty ?? 0, mat: price(cm.matPrice, k.row), lab: price(cm.labPrice, k.row), exp: price(cm.expPrice, k.row), src: `${s.name} ${k.row}행` }
            : { name: k.name, spec: k.spec, unit: k.unit || '식', qty: 1, mat: { v: k.mat_amt }, lab: { v: k.lab_amt }, exp: { v: k.exp_amt }, src: `${s.name} ${k.row}행 (금액)` });
          blocks.push({ sheet: s.name, row: g.row, name: g.name.replace(/^(No\.?|#)\s*\d+\s*/, '').trim() || g.name, code: (g.name.match(/^(No\.?\s*\d+|#\d+)/) || [''])[0], spec: g.spec, unit: g.unit,
            mat: g.mat_amt, lab: g.lab_amt, exp: g.exp_amt, lines });
        }
        break;
      }
      const kind = cMat && cLab && cExp ? 'triple' : cPrice ? (/노임/.test(s.name) ? 'labor' : /자재/.test(s.name) ? 'material' : 'price') : null;
      if (!kind) continue;
      for (let r = hr + 1; r <= maxRow && prices.length < 6000; r++) {
        const name = txt(s.name, addr(cName, r)); if (!name) continue;
        const e = { kind, sheet: s.name, row: r, name, spec: cSpec ? txt(s.name, addr(cSpec, r)) : '', unit: txt(s.name, addr(cUnit, r)) };
        if (kind === 'triple') {
          const t = (c) => ({ f: sheetRef(s.name, numToCol(c) + r), v: num(s.name, numToCol(c) + r) || 0 });
          Object.assign(e, { mat: t(cMat), lab: t(cLab), exp: t(cExp) });
          if (!e.mat.v && !e.lab.v && !e.exp.v) continue;
        } else {
          const v = num(s.name, numToCol(cPrice) + r); if (v == null) continue;
          e.price = { f: sheetRef(s.name, numToCol(cPrice) + r), v };
        }
        prices.push(e);
      }
      break;
    }
  }
  return { prices, blocks };
}
