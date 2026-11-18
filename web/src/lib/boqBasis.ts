// ④ 내역서 › 일위대가 · 단가: 엑셀 안 단가 자료(/api/boq/refs)와 내역 항목 잇기 + 호표 검산
//   내역 항목 단가 수식 → 일위대가목록 줄 → (이름이 같은) 호표 → 호표 줄 수식 → 노임 · 자재 단가표
//   호표 합계는 적산 엔진(computeUnits) 규칙: 줄마다 소수 첫째 자리까지 버림, 합계는 원 미만 버림
import { computeUnits, type Basis, type ULine } from './estimate';
import type { BoqItem } from './boqSheet';

export type RPrice = { v?: number; f?: string };
export type RLine = { name: string; spec?: string; unit?: string; qty: any; mat?: RPrice; lab?: RPrice; exp?: RPrice; src?: string };
export type RBlock = { sheet: string; row: number; name: string; code: string; spec?: string; unit?: string; mat: number; lab: number; exp: number; lines: RLine[] };
export type RRef = { kind: 'triple' | 'labor' | 'material' | 'price'; sheet: string; row: number; name: string; spec?: string; unit?: string; mat?: RPrice; lab?: RPrice; exp?: RPrice; price?: RPrice };
export type Refs = { prices: RRef[]; blocks: RBlock[] };
export type Amt3 = { m: number; l: number; e: number };

const n = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const nm = (s?: string | null) => (s || '').replace(/\s+/g, '');
const COLS = [['mat', 'm'], ['lab', 'l'], ['exp', 'e']] as const;

/** 수식 안 첫 번째 다른 시트 칸 → "'시트'!F3" ($ 없이). 못 찾으면 null */
const REF = /(?:'((?:[^']|'')+)'|([^\s'!()+\-*/,&=<>^"]+))!\$?([A-Z]{1,3})\$?(\d+)/;
export function cellOf(f?: string | null): { sheet: string; col: string; row: number; key: string } | null {
  const m = REF.exec(String(f || ''));
  if (!m) return null;
  const sheet = (m[1] ?? m[2]).replace(/''/g, "'");
  return { sheet, col: m[3], row: +m[4], key: `'${sheet}'!${m[3]}${m[4]}` };
}
export const blockKey = (b: { sheet: string; row: number }) => `${b.sheet}#${b.row}`;
export const refKey = blockKey;

/** 호표마다 엔진으로 다시 계산 (줄별 금액 · 합계) */
export function checkBlocks(blocks: RBlock[]) {
  const units = blocks.map((b) => ({
    no: blockKey(b), name: b.name, spec: b.spec || '', unit: b.unit || '',
    lines: b.lines.flatMap((ln, i) => COLS.map(([k, c]): ULine => ({ id: `${i}${c}`, kind: 'fixed', name: ln.name, spec: '', qty: 1, unit: '', col: c, amt: n(ln.qty) * n(ln[k]?.v) }))),
  }));
  const basis: Basis = { wages: {}, mats: {}, units, calcs: [] };
  const calc = computeUnits(basis);
  const out = new Map<string, { total: Amt3; excel: Amt3; lines: Amt3[]; same: boolean }>();
  for (const b of blocks) {
    const u = calc.get(blockKey(b));
    if (!u) continue;
    const lines: Amt3[] = b.lines.map((_, i) => ({ m: u.lines[i * 3].m, l: u.lines[i * 3 + 1].l, e: u.lines[i * 3 + 2].e }));
    const total = { m: u.total.m, l: u.total.l, e: u.total.e };
    const excel = { m: n(b.mat), l: n(b.lab), e: n(b.exp) };
    out.set(blockKey(b), { total, excel, lines, same: Math.abs(total.m - excel.m) < 1 && Math.abs(total.l - excel.l) < 1 && Math.abs(total.e - excel.e) < 1 });
  }
  return out;
}

/** 단가 자료 · 호표 · 내역 항목 사이 연결 */
export function buildLinks(refs: Refs, items: BoqItem[]) {
  // 단가 자료 칸 → 자료 줄
  const byCell = new Map<string, RRef>();
  for (const p of refs.prices) {
    const cells = p.kind === 'triple' ? [p.mat?.f, p.lab?.f, p.exp?.f] : [p.price?.f];
    for (const f of cells) { const c = cellOf(f); if (c) byCell.set(c.key, p); }
  }
  // 호표 줄 → 가리키는 단가 자료, 자료 → 쓰는 호표
  const lineRefs = new Map<string, RRef[][]>();
  const usedBy = new Map<string, RBlock[]>();
  for (const b of refs.blocks) {
    const per = b.lines.map((ln) => {
      const rs = new Set<RRef>();
      for (const [k] of COLS) { const c = cellOf(ln[k]?.f); const r = c && byCell.get(c.key); if (r) rs.add(r); }
      return [...rs];
    });
    lineRefs.set(blockKey(b), per);
    for (const r of new Set(per.flat())) { const k = refKey(r); usedBy.set(k, [...(usedBy.get(k) || []), b]); }
  }
  // 이름(+규격)으로 호표 찾기
  const byName = new Map<string, RBlock>(), byNameOnly = new Map<string, RBlock | null>();
  for (const b of refs.blocks) {
    byName.set(nm(b.name) + '|' + nm(b.spec), b);
    const k = nm(b.name); byNameOnly.set(k, byNameOnly.has(k) ? null : b); // 같은 이름이 둘 이상이면 이름만으로는 안 잇기
  }
  const blockFor = (name?: string, spec?: string | null) => byName.get(nm(name) + '|' + nm(spec)) || byNameOnly.get(nm(name)) || undefined;
  // 호표 시트 안 행 범위 (내역이 호표 시트를 바로 가리킬 때)
  const ranges = refs.blocks.map((b) => {
    const rows = b.lines.map((l) => +(/(\d+)행/.exec(l.src || '')?.[1] || 0)).filter(Boolean);
    return { b, from: b.row, to: Math.max(b.row, ...rows) };
  });
  // 내역 항목 → 근거
  const itemRef = new Map<number, { ref?: RRef; block?: RBlock }>();
  const blockUses = new Map<string, BoqItem[]>(), refUses = new Map<string, BoqItem[]>();
  for (const it of items) {
    if (it.section !== 'detail' || !(it.kind === 'item' || it.kind === 'link')) continue;
    const c = cellOf(it.price_ref);
    let ref: RRef | undefined, block: RBlock | undefined;
    if (c) {
      ref = byCell.get(c.key);
      if (ref?.kind === 'triple') block = blockFor(ref.name, ref.spec);
      if (!ref) block = ranges.find((x) => x.b.sheet === c.sheet && c.row >= x.from && c.row <= x.to)?.b;
    }
    if (!ref && !block) continue;
    itemRef.set(it.row, { ref, block });
    if (block) { const k = blockKey(block); blockUses.set(k, [...(blockUses.get(k) || []), it]); }
    if (ref) { const k = refKey(ref); refUses.set(k, [...(refUses.get(k) || []), it]); }
  }
  return { byCell, lineRefs, usedBy, itemRef, blockUses, refUses, blockFor };
}

export const sum3 = (a: Amt3) => a.m + a.l + a.e;
