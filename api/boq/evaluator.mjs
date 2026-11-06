// 워크북 수식 계산기
// 원본 엑셀의 수식을 그대로 계산합니다 (필요한 셀만, 한 번 계산한 값은 기억).
// set()으로 입력값을 바꾸면 그 뒤 계산은 바뀐 값 기준으로 다시 합니다.
import FormulaParser from 'fast-formula-parser';
import { numToCol, addr } from './xlsx.mjs';

const { FormulaError, FormulaHelpers, Types } = FormulaParser;

// 엑셀과 같게: 부동소수 오차(4791.79999…) 때문에 자릿수가 떨어지지 않도록 15자리로 정리 후 버림/반올림
const clean = (x) => Number(x.toPrecision(15));
const num = (p) => FormulaHelpers.accept(p, Types.NUMBER);
const digits = (p) => (p === undefined || p === null ? 0 : Math.trunc(FormulaHelpers.accept(p, Types.NUMBER, 0)));
const scale = (x, d, fn) => { const f = Math.pow(10, d); return clean(fn(clean(x * f)) / f); };
const FUNCS = {
  TRUNC: (x, d) => scale(num(x), digits(d), Math.trunc),
  ROUNDDOWN: (x, d) => scale(num(x), digits(d), Math.trunc),
  ROUNDUP: (x, d) => scale(num(x), digits(d), (v) => (v < 0 ? Math.floor(v) : Math.ceil(v))),
  ROUND: (x, d) => scale(num(x), digits(d), (v) => Math.sign(v) * Math.round(Math.abs(v))),
  INT: (x) => Math.floor(clean(num(x))),
  // 범위 · 여러 값 (빈 칸 · 글자는 엑셀처럼 건너뜀)
  MIN: (...a) => { const v = nums(a); return v.length ? Math.min(...v) : 0; },
  MAX: (...a) => { const v = nums(a); return v.length ? Math.max(...v) : 0; },
  AVERAGE: (...a) => { const v = nums(a); if (!v.length) throw FormulaError.DIV0; return clean(v.reduce((x, y) => x + y, 0) / v.length); },
  COUNT: (...a) => nums(a).length,
};
function nums(args) {
  const out = [];
  const walk = (x, direct) => {
    if (x == null) return;
    if (Array.isArray(x)) { x.forEach((y) => walk(y, false)); return; }
    if (typeof x === 'object' && 'value' in x) { walk(x.value, !x.isArray && !x.isRangeRef && direct); return; }
    if (typeof x === 'number') out.push(x);
    else if (direct && typeof x === 'string' && x.trim() !== '' && !isNaN(Number(x))) out.push(Number(x));
  };
  args.forEach((a) => walk(a, true));
  return out;
}

export class Evaluator {
  constructor(model) {
    this.model = model;
    this.over = new Map();     // 'Sheet!A1' → { v } | { f }
    this.memo = new Map();
    this.stack = new Set();
    this.parsers = [];          // 수식 안에서 다른 수식을 계산할 때 상태가 섞이지 않게 깊이마다 따로 씀
  }
  parserAt(depth) {
    if (!this.parsers[depth]) this.parsers[depth] = this.makeParser();
    return this.parsers[depth];
  }
  makeParser() {
    return new FormulaParser({
      functions: FUNCS,
      onCell: ({ sheet, row, col }) => this.value(sheet, addr(col, row)),
      onRange: (ref) => {
        const out = [];
        const s = ref.sheet;
        const r2 = Math.min(ref.to.row, this.maxRow(s));
        for (let r = ref.from.row; r <= r2; r++) {
          const line = [];
          for (let c = ref.from.col; c <= ref.to.col; c++) line.push(this.value(s, addr(c, r)));
          out.push(line);
        }
        return out;
      },
    });
  }
  maxRow(sheet) {
    const s = this.model.sheet(sheet); if (!s) return 0;
    if (!s._maxRow) { let m = 0; for (const a of s.cells.keys()) m = Math.max(m, +a.replace(/^[A-Z]+/, '')); s._maxRow = m; }
    return s._maxRow;
  }
  raw(sheet, a) {
    const k = sheet + '!' + a;
    if (this.over.has(k)) return this.over.get(k);
    return this.model.sheet(sheet)?.cells.get(a) || null;
  }
  set(sheet, a, x) { this.over.set(sheet + '!' + a, x); this.memo.clear(); }
  formula(sheet, a) { return this.raw(sheet, a)?.f || null; }
  cached(sheet, a) { return this.model.sheet(sheet)?.cells.get(a)?.v ?? null; }

  value(sheet, a) {
    const k = sheet + '!' + a;
    if (this.memo.has(k)) return this.memo.get(k);
    const c = this.raw(sheet, a);
    let v = null;
    if (c) {
      if (c.f) {
        if (this.stack.has(k)) v = c.v ?? 0;               // 순환 참조면 엑셀 저장값 사용
        else {
          this.stack.add(k);
          try {
            const { row, col } = { row: +a.replace(/^[A-Z]+/, ''), col: a.replace(/\d+$/, '') };
            const r = this.parserAt(this.stack.size).parse(c.f, { sheet, row, col: colIndex(col) });
            v = r instanceof FormulaError ? (c.v ?? null) : (Array.isArray(r) ? r[0][0] : r);
          } catch { v = c.v ?? null; }
          this.stack.delete(k);
        }
      } else v = c.v;
    }
    if (v === undefined) v = null;
    this.memo.set(k, v);
    return v;
  }
  num(sheet, a) { const v = this.value(sheet, a); return typeof v === 'number' ? v : Number(v) || 0; }
}

function colIndex(c) { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
export { numToCol };
