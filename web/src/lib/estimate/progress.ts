import type { Sheet } from './types';
import { mapSheet } from './estimate';

/** 기성: 항목 id → 회차별 금회 수량 */
export type Progress = Record<string, number[]>;

export function progressSheet(sheet: Sheet, prog: Progress, round: number, mode: 'prev' | 'this' | 'cum'): Sheet {
  return mapSheet(sheet, (l) => {
    if (l.children) return l;
    const p = prog[l.id] ?? [];
    let q = 0;
    if (mode === 'this') q = p[round] ?? 0;
    else if (mode === 'prev') q = p.slice(0, round).reduce((a, b) => a + b, 0);
    else q = p.slice(0, round + 1).reduce((a, b) => a + b, 0);
    return { ...l, qty: q };
  });
}
