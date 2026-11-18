// ④ 내역서 › 차수 · 기성 계산 — 적산 엔진(phaseSheet · splitByRatio · unassigned · progressSheet) 위에 얹은 도우미
//   수량은 DB에 { "엑셀 행": 수량 } 으로, 엔진 줄 id는 엑셀 행 번호(문자열)입니다.
import { flatten, lineAmount, phaseSheet, pickLines, progressSheet, splitByRatio, unassigned, type Amount, type Line, type PhaseAlloc, type Progress, type Sheet } from './estimate';
import type { BoqItem } from './boqSheet';

export type QtyMap = Record<string, number>;
const ZERO: Amount = { t: 0, l: 0, m: 0, e: 0 };
const addA = (a: Amount, b: Amount): Amount => ({ t: a.t + b.t, l: a.l + b.l, m: a.m + b.m, e: a.e + b.e });

export const total = (s: Sheet): Amount => s.sections.reduce((acc, sec) => sec.lines.reduce((a, l) => addA(a, lineAmount(l)), acc), ZERO);
export const leafAmt = (l: Line, q: number) => lineAmount({ ...l, qty: q }).t;
/** 항목 줄만 (공종 줄 제외), 트리 순서 */
export const leaves = (s: Sheet) => s.sections.flatMap((sec) => flatten(sec.lines)).filter((r) => !r.line.children);
/** 화면용: 공종 줄 + 항목 줄 (깊이 포함) */
export const rowsOf = (s: Sheet) => s.sections.flatMap((sec) => flatten(sec.lines));

/** 차수 · 회차 수량 묶음 → 엔진 형식 (줄 id → [차수별 수량]) */
export function toAlloc(maps: QtyMap[]): PhaseAlloc {
  const out: PhaseAlloc = {};
  const keys = new Set(maps.flatMap((m) => Object.keys(m)));
  for (const k of keys) out[k] = maps.map((m) => Number(m[k] || 0));
  return out;
}
const fromAlloc = (a: PhaseAlloc, n: number): QtyMap[] => Array.from({ length: n }, (_, i) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v[i] ?? 0]).filter(([, v]) => v)));

/* ---------- 차수 ---------- */
export function phaseTotals(sheet: Sheet, maps: QtyMap[]) {
  const alloc = toAlloc(maps);
  return maps.map((_, i) => total(phaseSheet(sheet, alloc, i)));
}
/** 미배정: 줄 id → 남은 수량, 남은 금액 */
export function unassignedOf(sheet: Sheet, maps: QtyMap[]) {
  const alloc = toAlloc(maps);
  const rest: QtyMap = {};
  let amt = 0;
  for (const r of leaves(sheet)) {
    const u = unassigned(r.line, alloc);
    if (Math.abs(u) > 1e-9) { rest[r.line.id] = u; amt += leafAmt(r.line, u); }
  }
  return { rest, amt };
}
/** 비율로 나누기 — keep(공종 · 항목 id)을 주면 그 아래 항목만. 마지막 차수가 끝수를 받음 */
export function splitRatio(sheet: Sheet, maps: QtyMap[], ratios: number[], keep?: Set<string>, digits = 3): QtyMap[] {
  const part = keep ? { sections: sheet.sections.map((s) => ({ ...s, lines: pickLines(s.lines, keep) })) } : sheet;
  const split = splitByRatio(part, ratios, digits);
  const alloc = toAlloc(maps);
  for (const [k, v] of Object.entries(split)) alloc[k] = v;
  return fromAlloc(alloc, maps.length);
}
/** 고른 줄을 통째로 한 차수에 */
export function moveAll(sheet: Sheet, maps: QtyMap[], to: number, keep: Set<string>): QtyMap[] {
  const part = { sections: sheet.sections.map((s) => ({ ...s, lines: pickLines(s.lines, keep) })) };
  const alloc = toAlloc(maps);
  for (const r of leaves(part)) alloc[r.line.id] = maps.map((_, i) => (i === to ? r.line.qty : 0));
  return fromAlloc(alloc, maps.length);
}

/* ---------- 기성 ---------- */
/** idx 회차의 전회까지 · 금회 · 누계 금액 */
export function roundAmounts(sheet: Sheet, maps: QtyMap[], idx: number) {
  const prog: Progress = toAlloc(maps);
  return {
    prev: total(progressSheet(sheet, prog, idx, 'prev')),
    cur: total(progressSheet(sheet, prog, idx, 'this')),
    cum: total(progressSheet(sheet, prog, idx, 'cum')),
  };
}
/** 줄 하나의 전회까지 수량 */
export const prevQty = (maps: QtyMap[], idx: number, id: string) => maps.slice(0, idx).reduce((s, m) => s + Number(m[id] || 0), 0);

/** 기준 내역서가 바뀌었을 때(설계변경 확정 → 준공내역서) 행 번호 옮기기: 공종명 · 규격 · 단위가 같은 항목끼리 */
export function rowMap(from: BoqItem[], to: BoqItem[]): Map<string, string> {
  const key = (i: BoqItem) => [i.name, i.spec, i.unit].map((x) => (x || '').replace(/\s+/g, '')).join('|');
  const leaf = (i: BoqItem) => i.section === 'detail' && (i.kind === 'item' || i.kind === 'link');
  const dest = new Map<string, string | null>();
  for (const i of to.filter(leaf)) { const k = key(i); dest.set(k, dest.has(k) ? null : String(i.row)); }
  const out = new Map<string, string>();
  for (const i of from.filter(leaf)) { const d = dest.get(key(i)); if (d) out.set(String(i.row), d); }
  return out;
}
export function remap(m: QtyMap, map: Map<string, string>): QtyMap {
  const out: QtyMap = {};
  for (const [k, v] of Object.entries(m)) { const d = map.get(k); if (d) out[d] = (out[d] || 0) + Number(v); }
  return out;
}

/** 수량 표기 정리 (소수 셋째 자리) */
export const q3 = (v: number) => Math.round(v * 1000) / 1000;
