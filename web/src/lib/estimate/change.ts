import type { Line, Sheet } from './types';
import { mapSheet, applyRate } from './estimate';

/** 설계변경: 당초(착공) 수량을 바꾸고, 신규 항목은 설계 단가 × 낙찰률 */
export interface ChangeOrder {
  name: string;
  qty: Record<string, number>;
  /** 신규 항목 — 설계 단가로 적는다 */
  added: Line[];
}

export const NEW_GROUP_ID = 'CHG-NEW';

export function changeSheet(start: Sheet, co: ChangeOrder, bidRate: number): Sheet {
  const changed = mapSheet(start, (l) => (l.children || co.qty[l.id] === undefined ? l : { ...l, qty: co.qty[l.id] }));
  if (!co.added.length) return changed;
  const priced = applyRate({ sections: [{ section: 'main', lines: co.added }] }, bidRate).sections[0].lines;
  return {
    sections: changed.sections.map((s) => {
      if (s.section !== 'main' || !s.lines[0]) return s;
      const root = s.lines[0];
      const grp: Line = { id: NEW_GROUP_ID, level: 2, mark: '○', name: '설계변경 신규 항목', spec: '', unit: '', qty: 0, lu: 0, mu: 0, eu: 0, children: priced };
      return { ...s, lines: [{ ...root, children: [...(root.children ?? []), grp] }, ...s.lines.slice(1)] };
    }),
  };
}
