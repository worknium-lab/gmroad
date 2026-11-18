// ④ 내역서 › 하도급: 원가계산 요율 읽기 + 하도급내역서 계산
//   지엠로드는 원가계산 요율을 엑셀(원가계산서 줄)에만 갖고 있어서, 기준 내역서의 원가계산서 금액과
//   공종별 내역 합(재료 · 노무 · 경비)으로 요율을 거꾸로 구합니다. 고른 요율은 엔진 공식으로 엑셀 금액을 그대로 다시 만들어 내는 가장 짧은 소수.
//   하도급 계산 순서는 적산 엔진 buildSubcontract 와 같음 (고른 공종 → 단가 × 하도급율 원 미만 버림 → 원가계산서, 대상 공급가액 천원 버림, 하도급 공급가액 = 대상 × 하도급율 끝수)
import { applyRate, costSheet, pickLines, roundTo, SUB_DEFAULT_EXCLUDE, type Amount, type CostKey, type CostRates, type CostResult, type Line, type RoundMode, type Sheet } from './estimate';
import { summaryAmt, type BoqItem } from './boqSheet';
import { total } from './boqProgress';

const fl = (v: number) => Math.floor(v + 1e-9);

/** floor(base × r) = amt 가 되는 가장 짧은 소수 r */
export function fitRate(amt: number, base: number): number {
  if (!base) return 0;
  for (let d = 2; d <= 9; d++) {
    const p = 10 ** d;
    const r = Math.ceil((amt / base) * p - 1e-9) / p;
    if (fl(base * r) === amt) return r;
  }
  return amt / base;
}

type Found = { key: CostKey; label: string; amount: number; rate: number };
const NAMES: [CostKey, RegExp, string][] = [
  ['il', /간접노무비/, '간접노무비'], ['ind', /산재보험/, '산재보험료'], ['emp', /고용보험/, '고용보험료'], ['health', /건강보험/, '건강보험료'],
  ['pension', /연금보험/, '연금보험료'], ['care', /노인장기요양/, '노인장기요양보험료'], ['retire', /퇴직공제/, '퇴직공제부금비'],
  ['machGuar', /건설기계/, '건설기계대여금 보증수수료'], ['safety', /산업안전보건/, '산업안전보건관리비'], ['env', /환경보전/, '환경보전비'],
  ['subGuar', /하도급대금/, '하도급대금 보증수수료'], ['etc', /기타경비/, '기타경비'], ['gen', /일반관리비/, '일반관리비'], ['profit', /이윤/, '이윤'], ['vat', /부가가치세/, '부가가치세'],
];

/** 기준 내역서의 원가계산서에서 요율 읽기 */
export function inferRates(items: BoqItem[], direct: Amount) {
  const amt = (re: RegExp) => summaryAmt(items, re);
  const got = new Map<CostKey, number>();
  for (const [k, re] of NAMES) { const v = amt(re); if (v !== null) got.set(k, v); }
  const A = direct.m, dl = direct.l, exp = direct.e;
  const g = (k: CostKey) => got.get(k) ?? 0;
  const B = dl + g('il');
  const C = exp + (['ind', 'emp', 'health', 'pension', 'care', 'retire', 'machGuar', 'safety', 'env', 'subGuar', 'etc'] as CostKey[]).reduce((s, k) => s + g(k), 0);
  const D = A + B + C;
  const waste = amt(/폐기물/) ?? 0;
  const H = D + g('gen') + g('profit') + waste;
  const BASE: Partial<Record<CostKey, number>> = {
    il: dl, ind: B, emp: B, health: dl, pension: dl, care: g('health'), retire: dl, machGuar: A + dl + exp, safety: A + dl, env: A + dl + exp,
    subGuar: A + dl + exp, etc: A + B, gen: D, profit: B + C + g('gen'), vat: H,
  };
  const rates: Partial<CostRates> = { subGuar: 0 };
  const found: Found[] = [];
  const exclude = new Set<CostKey>();
  for (const [k, , label] of NAMES) {
    if (!got.has(k)) { if (k !== 'subGuar') exclude.add(k); continue; }
    const r = fitRate(g(k), BASE[k] || 0);
    (rates as any)[k] = r;
    found.push({ key: k, label, amount: g(k), rate: r });
  }
  // 검산: 읽은 요율로 다시 계산한 도급액 ↔ 엑셀 도급액
  const calc = costSheet({ direct, rates, exclude, waste });
  return { rates, exclude, found, waste, calc };
}

export type SubInput = { sheet: Sheet; picks: Set<string>; rate: number; rates: Partial<CostRates>; exclude: Set<CostKey>; round: RoundMode };
export type SubResult = { targetLines: Line[]; subLines: Line[]; target: CostResult; sub: CostResult; tDirect: Amount; sDirect: Amount; ratio: number };

/** 하도급내역서 계산 (엔진 buildSubcontract와 같은 순서, 공사 요율 사용) */
export function subCalc({ sheet, picks, rate, rates, exclude, round }: SubInput): SubResult {
  const targetLines = pickLines(sheet.sections[0]?.lines || [], picks);
  const tSheet: Sheet = { sections: [{ section: 'main', lines: targetLines }] };
  const sSheet = applyRate(tSheet, rate);
  const tDirect = total(tSheet), sDirect = total(sSheet);
  const tCalc = costSheet({ direct: tDirect, rates, exclude });
  const target = costSheet({ direct: tDirect, rates, exclude, targetSupply: roundTo(tCalc.supply, 'floor1000') });
  const sub = costSheet({ direct: sDirect, rates, exclude, targetSupply: roundTo(target.supply * rate, round) });
  return { targetLines, subLines: sSheet.sections[0].lines, target, sub, tDirect, sDirect, ratio: target.total ? sub.total / target.total : 0 };
}

/** 하도급 기본 제외 비목 = 원도급사 부담 비목 + 이 공사 원가계산서에 없는 비목 */
export const defaultExclude = (missing: Set<CostKey>) => [...new Set([...SUB_DEFAULT_EXCLUDE, ...missing])];
export const ROUNDS: [RoundMode, string][] = [['floor1000', '천원 미만 버림'], ['floor10000', '만원 미만 버림'], ['ceil1000', '천원 올림'], ['none', '원 단위']];
