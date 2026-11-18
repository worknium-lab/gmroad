import type { Line, Sheet } from './types';
import { mapSheet } from './estimate';
import { floor } from './num';

/**
 * 근거 데이터 — 노임 · 자재 · 일위대가 호표 · 단가산출.
 * 호표는 노임·자재·다른 호표·단가산출을 수량으로 묶고, 값은 비목별로 원 미만 버림.
 */

export interface Wage { name: string; unit: string; old: number; cur: number | null; use: 'old' | 'cur'; code: string }
export interface Mat { key: string; name: string; spec: string; unit: string; price: number }

export type ULineKind = 'labor' | 'mat' | 'unit' | 'calc' | 'machine' | 'pct' | 'fixed';
export interface ULine {
  id: string;
  kind: ULineKind;
  name: string;
  spec: string;
  qty: number;
  unit: string;
  /** labor: 노임 이름 · mat: 자재 key · unit: 제N호표 · calc: 단산N · machine: M번호 */
  ref?: string;
  /** pct/fixed가 들어갈 비목 */
  col?: 'l' | 'm' | 'e';
  /** fixed 금액 */
  amt?: number;
  note?: string;
}
export interface UnitDef { no: string; name: string; spec: string; unit: string; note?: string; lines: ULine[]; from?: string }
export interface CalcDef {
  no: string; name: string; unit: string;
  /** 산출 당시 값 (원 미만 버림 전 합계와 같음) */
  l: number; m: number; e: number;
  /** 산출근거에서 읽은 노임 줄 — 노임이 바뀌면 그 차이만큼 노무비를 고친다 */
  laborLines?: { wage: string; mult: number }[];
  /** 노무비의 % 를 다른 비목에 넣는 줄 (공구손료 등) */
  pctOfLabor?: { col: 'm' | 'e'; pct: number };
  /** 산출근거의 장비 줄 — 시간당 기계경비 × 배수 */
  machineLines?: { machine: string; col: 'l' | 'm' | 'e'; mult: number; base: number }[];
  /** 산출근거를 줄 단위로 구조화한 것 — 있으면 이것으로 계산한다 */
  lines?: CalcLine[];
  /** 이 프로그램에서 새로 작성한 산출 */
  own?: boolean;
}

type Col = 'l' | 'm' | 'e';
/** 단가산출 산출근거 한 줄 */
export type CalcLine = CalcLineBase & { added?: boolean };
type CalcLineBase =
  | { k: 'text'; text: string; ind: number; bold?: boolean; ref?: string }
  /** 노임 × 인 (÷ 기준수량) */
  | { k: 'labor'; wage: string; n: number; div?: number; per?: string; base: number; ind: number; ref?: string }
  /** 자재단가 × 수량 × 할증 … */
  | { k: 'mat'; mat: string; name: string; spec: string; f: { v: number; u?: string }[]; base: number; ind: number; ref?: string }
  /** 기계경비(시간당) ×/÷ … — v 가 'Q' 이면 같은 산출의 작업량 Q */
  | { k: 'mach'; machine: string; col: Col; ops: { op: '×' | '÷'; v: number | 'Q'; u?: string }[]; base: number; ind: number; ref?: string }
  /** 작업량 Q = 3,600 × q × K × f × E ÷ Cm */
  | { k: 'q'; q: number; K: number; f: number; E: number; Cm: number; unit: string; base: number; ind: number }
  /** 앞 노무비 소계의 % */
  | { k: 'pct'; pct: number; col: Col; base: number; ind: number }
  /** 소계 · 계 — cols 는 산출 당시 값 */
  | { k: 'sub'; label: string; cols: Partial<Record<Col, number>>; tag?: string; final?: boolean; ind: number };

export interface CalcEvalRow { line: CalcLine; now: number; price?: number; cols?: Partial<Record<Col, number>> }
const r2 = (x: number) => Math.round(x * 100) / 100;
export const qOf = (x: { q: number; K: number; f: number; E: number; Cm: number }) => r2((3600 * x.q * x.K * x.f * x.E) / (x.Cm || 1));

/** 산출근거를 지금 노임·자재·기계경비로 다시 계산 */
export function calcEval(b: Basis, c: CalcDef): { rows: CalcEvalRow[]; price: Price } {
  const wages = new Map(Object.values(b.wages).map((w) => [normName(w.name), w]));
  const rows: CalcEvalRow[] = [];
  const delta: Record<Col, number> = { l: 0, m: 0, e: 0 };
  const then: Record<Col, number> = { l: 0, m: 0, e: 0 };
  let seg: Record<Col, number> = { l: 0, m: 0, e: 0 };
  let lastLabor = 0;
  let Q = 0;
  const add = (col: Col, now: number, base: number) => { delta[col] += now - base; seg[col] += now - base; then[col] += base; };
  for (const ln of c.lines ?? []) {
    switch (ln.k) {
      case 'labor': {
        const w = wages.get(normName(ln.wage));
        const price = w ? wageOf(w) : 0;
        const now = r1((price * ln.n) / (ln.div || 1));
        add('l', now, ln.base); lastLabor = r1(lastLabor + now); rows.push({ line: ln, now, price }); break;
      }
      case 'mat': {
        const price = b.mats[ln.mat]?.price ?? 0;
        const now = r1(ln.f.reduce((a, x) => a * x.v, price));
        add('m', now, ln.base); rows.push({ line: ln, now, price }); break;
      }
      case 'mach': {
        const md = b.machines?.find((x) => x.no === ln.machine);
        const price = md ? machinePrice(b, md).total[ln.col] : 0;
        let v = price;
        for (const o of ln.ops) { const n = o.v === 'Q' ? Q : o.v; v = o.op === '×' ? v * n : n ? v / n : 0; }
        const now = r1(v);
        add(ln.col, now, ln.base); rows.push({ line: ln, now, price }); break;
      }
      case 'q': Q = qOf(ln); rows.push({ line: ln, now: Q }); break;
      case 'pct': {
        const now = r1((lastLabor * ln.pct) / 100);
        add(ln.col, now, ln.base); rows.push({ line: ln, now, price: lastLabor }); break;
      }
      case 'sub': {
        if (ln.final) { rows.push({ line: ln, now: 0 }); break; }
        const cols: Partial<Record<Col, number>> = {};
        let t = 0;
        for (const k of ['l', 'm', 'e'] as Col[]) if (ln.cols[k] !== undefined || Math.abs(seg[k]) > 1e-9) { cols[k] = r1((ln.cols[k] ?? 0) + seg[k]); t += cols[k]!; }
        rows.push({ line: ln, now: r1(t), cols });
        seg = { l: 0, m: 0, e: 0 };
        break;
      }
      default: rows.push({ line: ln, now: 0 });
    }
  }
  // 산출근거가 모두 들어 있으면 원 미만 버리기 전 합계에서, 일부만 있으면 저장된 값에 차이를 더한다
  const col = (k: Col) => floor((Math.floor(then[k]) === c[k] && then[k] ? then[k] : c[k]) + delta[k] + 1e-6);
  const price = { l: col('l'), m: col('m'), e: col('e') };
  for (const r of rows) if (r.line.k === 'sub' && r.line.final) { r.cols = { l: price.l || undefined, m: price.m || undefined, e: price.e || undefined }; r.now = price.l + price.m + price.e; }
  return { rows, price };
}

/** 단가산출 값 — 연결된 노임 줄·장비 줄이 바뀌면 그 차이를 더한다 */
export function calcPrice(b: Basis, c: CalcDef): Price {
  if (c.lines?.length) return calcEval(b, c).price;
  if (!c.laborLines?.length && !c.machineLines?.length) return { l: c.l, m: c.m, e: c.e };
  const wages = new Map(Object.values(b.wages).map((w) => [normName(w.name), w]));
  let dl = 0, dm = 0, de = 0;
  for (const ln of c.laborLines ?? []) {
    const w = wages.get(normName(ln.wage));
    if (w) dl += (wageOf(w) - w.old) * ln.mult;
  }
  dl = r1(dl);
  if (c.pctOfLabor) {
    const d = r1((dl * c.pctOfLabor.pct) / 100);
    if (c.pctOfLabor.col === 'm') dm += d; else de += d;
  }
  for (const ml of c.machineLines ?? []) {
    const md = b.machines?.find((x) => x.no === ml.machine);
    if (!md) continue;
    const d = r1((machinePrice(b, md).total[ml.col] - ml.base) * ml.mult);
    if (ml.col === 'l') dl += d; else if (ml.col === 'm') dm += d; else de += d;
  }
  return { l: floor(c.l + dl), m: floor(c.m + dm), e: floor(c.e + de) };
}

/** 견적단가 — 업체 견적 여러 곳 중 최저가/평균/지정 */
export interface QuoteDef {
  no: string; name: string; spec: string; unit: string;
  /** 견적가가 들어갈 비목 */
  col: 'l' | 'm' | 'e';
  vendors: { name: string; price: number; date?: string }[];
  method: 'min' | 'avg' | 'pick';
  pick?: number;
}

export function quotePrice(q: QuoteDef): number {
  const ps = q.vendors.map((v) => v.price).filter((x) => x > 0);
  if (!ps.length) return 0;
  if (q.method === 'pick') return q.vendors[q.pick ?? 0]?.price ?? 0;
  if (q.method === 'avg') return Math.floor(ps.reduce((a, b) => a + b, 0) / ps.length);
  return Math.min(...ps);
}

/** 기계경비 (시간당) — 손료 + 연료·잡품 + 운전사 노임 */
export interface MachineDef {
  no: string; name: string; spec: string;
  /** 손료: 취득가격 × 시간당 손료계수(×10⁻⁷) — 장비가 둘이면 두 줄 */
  losses: { name: string; price: number; coef: number }[];
  fuel: string;      // 경유 · 휘발유
  fuelQty: number;   // ℓ/hr
  sundry: number;    // 잡품 (주연료의 %)
  operator: string;  // 운전사 노임 직종
  note?: string;
}

export interface Basis {
  wages: Record<string, Wage>;
  mats: Record<string, Mat>;
  units: UnitDef[];
  calcs: CalcDef[];
  machines?: MachineDef[];
  quotes?: QuoteDef[];
  /** 연료 단가 (기계경비 적용기준) */
  fuel?: Record<string, number>;
}

const r1 = (x: number) => Math.floor(x * 10 + 1e-6) / 10;

export interface MachineCalc { def: MachineDef; loss: number; fuelAmt: number; sundryAmt: number; op: number; total: Price }

/** 시간당 기계경비: 손료(경비) · 연료+잡품(재료비) · 운전사 노임 × 1/8 × 16/12 × 25/20 (노무비) */
export function machinePrice(b: Basis, m: MachineDef): MachineCalc {
  const wages = new Map(Object.values(b.wages).map((w) => [normName(w.name), w]));
  const w = wages.get(normName(m.operator));
  const loss = m.losses.reduce((a, x) => a + r1(x.price * x.coef * 1e-7), 0);
  const fuelAmt = r1(m.fuelQty * (b.fuel?.[m.fuel] ?? 0));
  const sundryAmt = r1((fuelAmt * m.sundry) / 100);
  const op = r1((w ? wageOf(w) : 0) * (1 / 8) * (16 / 12) * (25 / 20));
  return { def: m, loss, fuelAmt, sundryAmt, op, total: { l: floor(op), m: floor(fuelAmt + sundryAmt), e: floor(loss) } };
}

export interface Price { l: number; m: number; e: number }
export interface LineCalc { line: ULine; price: number; l: number; m: number; e: number }
export interface UnitCalc { def: UnitDef; total: Price; lines: LineCalc[]; error?: string }

export const normName = (s: string) => s.replace(/\s+/g, '');
export const wageOf = (w: Wage) => (w.use === 'cur' && w.cur ? w.cur : w.old);

/** 모든 호표를 계산 (하위 호표 먼저, 순환 참조는 0으로 막음) */
export function computeUnits(b: Basis): Map<string, UnitCalc> {
  const defs = new Map(b.units.map((u) => [u.no, u]));
  const calcs = new Map(b.calcs.map((c) => [c.no, c]));
  const wages = new Map(Object.values(b.wages).map((w) => [normName(w.name), w]));
  const out = new Map<string, UnitCalc>();
  const busy = new Set<string>();

  const unit = (no: string): UnitCalc | undefined => {
    if (out.has(no)) return out.get(no);
    const def = defs.get(no);
    if (!def) return undefined;
    if (busy.has(no)) return { def, total: { l: 0, m: 0, e: 0 }, lines: [], error: '순환 참조' };
    busy.add(no);
    const lines: LineCalc[] = [];
    let sl = 0, sm = 0, se = 0;
    for (const ln of def.lines) {
      let l = 0, m = 0, e = 0, price = 0;
      if (ln.kind === 'labor') {
        const w = wages.get(normName(ln.ref ?? ln.name));
        price = w ? wageOf(w) : 0;
        l = ln.qty * price;
      } else if (ln.kind === 'mat') {
        price = b.mats[ln.ref ?? '']?.price ?? 0;
        m = ln.qty * price;
      } else if (ln.kind === 'unit') {
        const u = unit(ln.ref ?? '');
        const p = u?.total ?? { l: 0, m: 0, e: 0 };
        price = p.l + p.m + p.e;
        l = ln.qty * p.l; m = ln.qty * p.m; e = ln.qty * p.e;
      } else if (ln.kind === 'calc') {
        const c = calcs.get(ln.ref ?? '');
        const p = c ? calcPrice(b, c) : { l: 0, m: 0, e: 0 };
        price = p.l + p.m + p.e;
        l = ln.qty * p.l; m = ln.qty * p.m; e = ln.qty * p.e;
      } else if (ln.kind === 'machine') {
        const md = b.machines?.find((x) => x.no === ln.ref);
        const p = md ? machinePrice(b, md).total : { l: 0, m: 0, e: 0 };
        price = p.l + p.m + p.e;
        l = ln.qty * p.l; m = ln.qty * p.m; e = ln.qty * p.e;
      } else if (ln.kind === 'pct') {
        price = sl; // 노무비의 %
        const v = (sl * ln.qty) / 100;
        if (ln.col === 'm') m = v; else if (ln.col === 'l') l = v; else e = v;
      } else {
        const v = ln.amt ?? 0;
        price = v;
        if (ln.col === 'm') m = v; else if (ln.col === 'l') l = v; else e = v;
      }
      // 금액은 소수 첫째 자리까지 (호표 양식 관례)
      const r1 = (x: number) => Math.floor(x * 10 + 1e-6) / 10;
      l = r1(l); m = r1(m); e = r1(e);
      sl += l; sm += m; se += e;
      lines.push({ line: ln, price, l, m, e });
    }
    busy.delete(no);
    const res: UnitCalc = { def, total: { l: floor(sl), m: floor(sm), e: floor(se) }, lines };
    out.set(no, res);
    return res;
  };
  for (const u of b.units) unit(u.no);
  return out;
}

export function basisPrice(b: Basis, units: Map<string, UnitCalc>, ref?: string): Price | undefined {
  if (!ref) return undefined;
  const u = units.get(ref);
  if (u) return u.total;
  const c = b.calcs.find((x) => x.no === ref);
  if (c) return calcPrice(b, c);
  const q = b.quotes?.find((x) => x.no === ref);
  if (q) { const p = quotePrice(q); return { l: q.col === 'l' ? p : 0, m: q.col === 'm' ? p : 0, e: q.col === 'e' ? p : 0 }; }
  return undefined;
}

/** 근거에 연결된 내역 줄의 단가를 근거 값으로 바꾼다 (설계내역서) */
export function resolveSheet(sheet: Sheet, b: Basis, units = computeUnits(b)): Sheet {
  const linked = mapSheet(sheet, (l: Line) => {
    if (l.children || !l.link) return l;
    const p = basisPrice(b, units, l.ref);
    if (!p) return l;
    if (l.asExpense) return { ...l, lu: 0, mu: 0, eu: p.l + p.m + p.e };
    return { ...l, lu: p.l, mu: p.m, eu: p.e };
  });
  return applyPct(linked);
}

/** 잡비 줄: 같은 공종 안 다른 항목 금액의 % (원 미만 버림) — 단가로 넣고 수량은 1 */
export function applyPct(sheet: Sheet): Sheet {
  return mapSheet(sheet, (g: Line) => {
    if (!g.children?.some((c) => c.pct)) return g;
    const sum = { l: 0, m: 0, e: 0, t: 0 };
    for (const c of g.children) {
      if (c.pct || c.children) continue;
      const l = floor(c.qty * c.lu), m = floor(c.qty * c.mu), e = floor(c.qty * c.eu);
      sum.l += l; sum.m += m; sum.e += e; sum.t += l + m + e;
    }
    return {
      ...g,
      children: g.children.map((c) => {
        if (!c.pct) return c;
        const v = floor((sum[c.pct.of] * c.pct.pct) / 100);
        return { ...c, qty: 1, lu: c.pct.to === 'l' ? v : 0, mu: c.pct.to === 'm' ? v : 0, eu: c.pct.to === 'e' ? v : 0 };
      }),
    };
  });
}

/** 이 근거를 쓰는 곳 (호표 → 상위 호표, 내역 줄) */
export function usages(b: Basis, sheet: Sheet, ref: string): string[] {
  const out: string[] = [];
  for (const u of b.units) if (u.lines.some((x) => x.ref === ref || (x.kind === 'labor' && normName(x.ref ?? x.name) === ref))) out.push(u.no);
  for (const c of b.calcs) if (c.lines?.some((x) => x.k === 'mach' && x.machine === ref)) out.push(c.no);
  for (const c of b.calcs) if (c.lines?.some((x) => (x.k === 'mat' && x.mat === ref) || (x.k === 'labor' && normName(x.wage) === ref))) out.push(c.no);
  const walk = (ls: Line[]) => ls.forEach((l) => { if (l.ref === ref) out.push(`내역 · ${l.name}`); if (l.children) walk(l.children); });
  sheet.sections.forEach((s) => walk(s.lines));
  return out;
}
