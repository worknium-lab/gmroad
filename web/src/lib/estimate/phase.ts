import type { Line, Sheet } from './types';
import { mapSheet, flatten } from './estimate';
import { floor } from './num';

/** 차수별 분개: 항목 id → 차수별 수량 */
export type PhaseAlloc = Record<string, number[]>;

/** 비율로 나누기 — 마지막 차수가 남는 수량(끝수)을 받는다 */
export function splitByRatio(sheet: Sheet, ratios: number[], digits = 2): PhaseAlloc {
  const out: PhaseAlloc = {};
  const pow = 10 ** digits;
  for (const s of sheet.sections) {
    for (const r of flatten(s.lines)) {
      const l = r.line;
      if (l.children) continue;
      const parts = ratios.map((x) => floor(l.qty * x * pow) / pow);
      const rest = +(l.qty - parts.slice(0, -1).reduce((a, b) => a + b, 0)).toFixed(digits);
      parts[parts.length - 1] = rest;
      out[l.id] = parts;
    }
  }
  return out;
}

/** n차분 내역서 — 수량만 바꾼 착공내역서 */
export function phaseSheet(sheet: Sheet, alloc: PhaseAlloc, phase: number): Sheet {
  return mapSheet(sheet, (l) => (l.children ? l : { ...l, qty: alloc[l.id]?.[phase] ?? 0 }));
}

export function unassigned(line: Line, alloc: PhaseAlloc): number {
  const a = alloc[line.id] ?? [];
  return +(line.qty - a.reduce((x, y) => x + y, 0)).toFixed(4);
}
