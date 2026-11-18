import type { Amount, Line, Sheet } from './types';
import { applyRate, pickLines, sectionAmount, lineAmount, ZERO, add } from './estimate';
import { costSheet, roundTo, type CostKey, type CostResult, type RoundMode, type ExtraItem } from './cost';

/** 하도급에서 기본으로 빼는 비목 — 원도급사가 부담하는 보험료·공제부금·보증수수료 */
export const SUB_DEFAULT_EXCLUDE: CostKey[] = ['ind', 'emp', 'health', 'pension', 'care', 'retire', 'machGuar', 'subGuar'];

export interface SubcontractInput {
  /** 착공내역서 */
  base: Sheet;
  /** 하도급할 공종(또는 항목) id */
  pick: Set<string>;
  /** 하도급율 (0.82) */
  rate: number;
  exclude: Set<CostKey>;
  /** 하도급 공급가액 끝수 */
  round: RoundMode;
  /** 원가계산서 추가 비목 */
  extra?: ExtraItem[];
}

export interface SubcontractResult {
  /** 하도급대상 내역 (착공 단가 그대로, 하도급 공종만) */
  targetLines: Line[];
  /** 하도급 내역 (단가 × 하도급율) */
  subLines: Line[];
  target: CostResult;
  sub: CostResult;
  ratio: number;
}

function mainOnly(lines: Line[]): Sheet {
  return { sections: [{ section: 'main', lines }] };
}

export function buildSubcontract(inp: SubcontractInput): SubcontractResult {
  const main = inp.base.sections.find((s) => s.section === 'main')?.lines ?? [];
  const targetLines = pickLines(main, inp.pick);
  const targetSheet = mainOnly(targetLines);
  const subSheet = applyRate(targetSheet, inp.rate);
  const subLines = subSheet.sections[0].lines;

  const tDirect = sectionAmount(targetSheet, 'main');
  const tCalc = costSheet({ direct: tDirect, exclude: inp.exclude, extra: inp.extra });
  const target = costSheet({ direct: tDirect, exclude: inp.exclude, extra: inp.extra, targetSupply: roundTo(tCalc.supply, 'floor1000') });

  const sDirect = sectionAmount(subSheet, 'main');
  const sub = costSheet({ direct: sDirect, exclude: inp.exclude, extra: inp.extra, targetSupply: roundTo(target.supply * inp.rate, inp.round) });
  return { targetLines, subLines, target, sub, ratio: target.total ? sub.total / target.total : 0 };
}

export function linesAmount(lines: Line[]): Amount {
  return lines.reduce((s, l) => add(s, lineAmount(l)), ZERO);
}
