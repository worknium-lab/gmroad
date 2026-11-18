import type { Amount, Line, Sheet } from './types';
import { floor } from './num';

export const ZERO: Amount = { t: 0, l: 0, m: 0, e: 0 };

export function add(a: Amount, b: Amount): Amount {
  return { t: a.t + b.t, l: a.l + b.l, m: a.m + b.m, e: a.e + b.e };
}

/** 항목 한 줄의 금액 — 비목별로 수량 × 단가를 원 미만 버리고, 합계는 세 금액의 합 */
export function lineAmount(line: Line): Amount {
  if (line.children && line.children.length) {
    return line.children.reduce((s, c) => add(s, lineAmount(c)), ZERO);
  }
  const l = floor(line.qty * line.lu);
  const m = floor(line.qty * line.mu);
  const e = floor(line.qty * line.eu);
  return { t: l + m + e, l, m, e };
}

export function unitTotal(line: Line): number {
  return line.lu + line.mu + line.eu;
}

export function sectionAmount(sheet: Sheet, section: Sheet['sections'][number]['section']): Amount {
  const s = sheet.sections.find((x) => x.section === section);
  if (!s) return ZERO;
  return s.lines.reduce((acc, l) => add(acc, lineAmount(l)), ZERO);
}

export function mapLines(lines: Line[], fn: (l: Line) => Line): Line[] {
  return lines.map((l) => {
    const n = fn(l);
    return n.children ? { ...n, children: mapLines(n.children, fn) } : n;
  });
}

export function mapSheet(sheet: Sheet, fn: (l: Line) => Line): Sheet {
  return { sections: sheet.sections.map((s) => ({ ...s, lines: mapLines(s.lines, fn) })) };
}

/** 단가에 비율을 곱해 원 미만 버림 (설계 → 착공 낙찰률, 착공 → 하도급 하도급율) */
export function applyRate(sheet: Sheet, rate: number, opts: { skipSupplied?: boolean } = {}): Sheet {
  return {
    sections: sheet.sections.map((s) => {
      if (opts.skipSupplied && s.section !== 'main') return s;
      return {
        ...s,
        lines: mapLines(s.lines, (l) =>
          l.children ? l : { ...l, lu: floor(l.lu * rate), mu: floor(l.mu * rate), eu: floor(l.eu * rate) },
        ),
      };
    }),
  };
}

/** 트리를 화면용 평면 목록으로. depth와 조상 id를 같이 준다. */
export interface FlatRow {
  line: Line;
  depth: number;
  ancestors: string[];
  amount: Amount;
}

export function flatten(lines: Line[], depth = 0, ancestors: string[] = []): FlatRow[] {
  const out: FlatRow[] = [];
  for (const l of lines) {
    out.push({ line: l, depth, ancestors, amount: lineAmount(l) });
    if (l.children) out.push(...flatten(l.children, depth + 1, [...ancestors, l.id]));
  }
  return out;
}

export function findLine(lines: Line[], id: string): Line | undefined {
  for (const l of lines) {
    if (l.id === id) return l;
    if (l.children) {
      const f = findLine(l.children, id);
      if (f) return f;
    }
  }
  return undefined;
}

/** 선택한 공종 id만 남긴 트리 (조상은 유지) */
export function pickLines(lines: Line[], keep: Set<string>): Line[] {
  const out: Line[] = [];
  for (const l of lines) {
    if (keep.has(l.id)) {
      out.push(l);
    } else if (l.children) {
      const kids = pickLines(l.children, keep);
      if (kids.length) out.push({ ...l, children: kids });
    }
  }
  return out;
}

let seq = 0;
export function newId(prefix = 'n'): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

function editLines(lines: Line[], fn: (siblings: Line[]) => Line[] | null): Line[] {
  const r = fn(lines);
  if (r) return r;
  return lines.map((l) => (l.children ? { ...l, children: editLines(l.children, fn) } : l));
}

function editSheet(sheet: Sheet, fn: (siblings: Line[]) => Line[] | null): Sheet {
  return { sections: sheet.sections.map((s) => ({ ...s, lines: editLines(s.lines, fn) })) };
}

/** id 줄 바로 뒤(같은 부모)에 끼워 넣기. 공종 줄을 골랐으면 그 공종 맨 앞에 */
export function insertAfter(sheet: Sheet, id: string, items: Line[]): Sheet {
  const target = sheet.sections.flatMap((s) => flatten(s.lines)).find((r) => r.line.id === id)?.line;
  if (target?.children) {
    return mapSheet(sheet, (l) => (l.id === id ? { ...l, children: [...items, ...(l.children ?? [])] } : l));
  }
  return editSheet(sheet, (sib) => {
    const i = sib.findIndex((l) => l.id === id);
    if (i < 0) return null;
    return [...sib.slice(0, i + 1), ...items, ...sib.slice(i + 1)];
  });
}

export function removeLine(sheet: Sheet, id: string): Sheet {
  return editSheet(sheet, (sib) => (sib.some((l) => l.id === id) ? sib.filter((l) => l.id !== id) : null));
}

export function cloneLine(l: Line): Line {
  return { ...l, id: newId('c'), children: l.children?.map(cloneLine) };
}

export function allLines(sheet: Sheet): Line[] {
  return sheet.sections.flatMap((s) => flatten(s.lines).map((r) => r.line));
}
