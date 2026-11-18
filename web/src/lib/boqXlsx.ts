// ④ 내역서 › 차수 · 기성 · 하도급 엑셀 — 적산 엔진 결과를 표로 만들어 /api/boq/sheet-xlsx 로 보냄
//   항목 금액은 비목별 TRUNC(수량 × 단가, 0)의 합(엔진 규칙과 같음), 공종 줄은 SUBTOTAL(아래 줄), 합계는 SUBTOTAL(전체)
//   자리표: {r} 이 줄 · {end} 이 줄 + span · {first} 첫 줄 · {prev} 윗줄 (API가 바꿈), {r1} 다음 줄 (보내기 전에 여기서 바꿈)
import { api } from './supabase';
import { flatten, lineAmount, type CostResult, type Line } from './estimate';

export type XCell = string | number | null | { f: string; v: number };
export type XRow = { c: XCell[]; style?: 'g0' | 'g1' | 'total'; indent?: number; span?: number };
export type XCol = { h: string; w: number; fmt?: string; align?: 'center' };
export type XSheet = { name: string; title: string; sub?: string; cols: XCol[]; rows: XRow[] };

const N0 = '#,##0', NQ = '#,##0.###';
const fl = (v: number) => Math.floor(v + 1e-9);
const colL = (i: number) => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const amt3 = (q: number, l: Line) => fl(q * l.mu) + fl(q * l.lu) + fl(q * l.eu);
/** 수량 칸 Q · 단가 칸 M/L/E 로 금액 수식 */
const fAmt = (Q: string, M: string, L: string, E: string) => `TRUNC(${Q}{r}*${M}{r},0)+TRUNC(${Q}{r}*${L}{r},0)+TRUNC(${Q}{r}*${E}{r},0)`;

/** 트리 → 줄 목록 + 공종 아래 줄 수(span) */
function tree(lines: Line[]) {
  const rows = flatten(lines);
  return rows.map((r, i) => {
    let span = 0;
    for (let j = i + 1; j < rows.length && rows[j].ancestors.includes(r.line.id); j++) span++;
    return { ...r, span };
  });
}
/** 공종 줄 금액: 바로 아래 줄 ~ 마지막 하위 줄의 SUBTOTAL (하위 공종의 SUBTOTAL은 SUBTOTAL이 알아서 빼고 더함) */
const groupF = (C: string, v: number): XCell => ({ f: `SUBTOTAL(9,${C}{r1}:${C}{end})`, v });

export async function downloadXlsx(projectId: string, file: string, sheets: XSheet[]) {
  // {r1}(다음 줄)은 여기서 줄 번호로 바꿈 — 데이터는 4행부터
  const fixed = sheets.map((s) => ({
    ...s,
    rows: s.rows.map((row, i) => ({ ...row, c: row.c.map((c) => (c && typeof c === 'object' ? { ...c, f: c.f.replace(/\{r1\}/g, String(4 + i + 1)) } : c)) })),
  }));
  const r = await api('/api/boq/sheet-xlsx', { project_id: projectId, doc: { file, sheets: fixed } });
  const bin = atob(r.base64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = r.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** 원가계산서 시트 (여러 열 나란히: 예) 금회 · 누계 / 대상 · 하도급) */
export function costXSheet(title: string, sub: string, cols: [string, CostResult][]): XSheet {
  const keys = cols[0][1].rows.filter((r) => cols.some(([, c]) => c.rows.find((x) => x.key === r.key)?.amount != null));
  return {
    name: '원가계산서', title, sub,
    cols: [{ h: '번호', w: 6, align: 'center' }, { h: '비목', w: 30 }, { h: '요율 · 산출근거', w: 28 }, ...cols.map(([h]) => ({ h, w: 18, fmt: N0 }))],
    rows: keys.map((r) => ({ c: [r.no, (r.group && !r.total ? `${r.group} · ` : '') + r.label, [r.rate, r.basis].filter(Boolean).join('  '), ...cols.map(([, c]) => c.rows.find((x) => x.key === r.key)?.amount ?? null)], style: r.total ? 'g1' : undefined })),
  };
}

/* ---------- 기성내역서 ---------- */
export function roundXSheet(o: { title: string; sub: string; lines: Line[]; prev: (id: string) => number; cur: (id: string) => number }): XSheet {
  // A 공종명 · B 규격 · C 단위 · D 계약 수량 · E 재료비 단가 · F 노무비 단가 · G 경비 단가 · H 전회까지 · I 금회 · J 누계 · K 전회 금액 · L 금회 금액 · M 누계 금액
  const cols: XCol[] = [{ h: '공종명', w: 34 }, { h: '규격', w: 18 }, { h: '단위', w: 6, align: 'center' }, { h: '계약 수량', w: 11, fmt: NQ },
    { h: '재료비 단가', w: 12, fmt: N0 }, { h: '노무비 단가', w: 12, fmt: N0 }, { h: '경비 단가', w: 12, fmt: N0 },
    { h: '전회까지 수량', w: 11, fmt: NQ }, { h: '금회 수량', w: 11, fmt: NQ }, { h: '누계 수량', w: 11, fmt: NQ },
    { h: '전회까지 금액', w: 15, fmt: N0 }, { h: '금회 금액', w: 15, fmt: N0 }, { h: '누계 금액', w: 15, fmt: N0 }];
  const rows: XRow[] = [];
  for (const r of tree(o.lines)) {
    const l = r.line;
    if (l.children) {
      const sum = (f: (x: Line) => number) => { let s = 0; const w = (ls: Line[]) => ls.forEach((x) => (x.children ? w(x.children) : (s += f(x)))); w(l.children!); return s; };
      const a = [sum((x) => amt3(o.prev(x.id), x)), sum((x) => amt3(o.cur(x.id), x)), sum((x) => amt3(o.prev(x.id) + o.cur(x.id), x))];
      rows.push({ c: [l.name, '', '', null, null, null, null, null, null, null, groupF('K', a[0]), groupF('L', a[1]), groupF('M', a[2])], style: r.depth === 0 ? 'g0' : 'g1', indent: r.depth, span: r.span });
      continue;
    }
    const p = o.prev(l.id), c = o.cur(l.id), u = p + c;
    const a = [amt3(p, l), amt3(c, l), amt3(u, l)];
    rows.push({ c: [l.name, l.spec, l.unit, l.qty, l.mu, l.lu, l.eu, p || null, c || null, { f: 'H{r}+I{r}', v: u },
      { f: fAmt('H', 'E', 'F', 'G'), v: a[0] }, { f: fAmt('I', 'E', 'F', 'G'), v: a[1] }, { f: fAmt('J', 'E', 'F', 'G'), v: a[2] }], indent: r.depth });
  }
  const all = o.lines.reduce((s, l) => { const w = (ls: Line[]): number[] => ls.reduce((acc, x) => { const v = x.children ? w(x.children) : [amt3(o.prev(x.id), x), amt3(o.cur(x.id), x), amt3(o.prev(x.id) + o.cur(x.id), x)]; return acc.map((y, i) => y + v[i]); }, [0, 0, 0]); const v = w([l]); return s.map((y, i) => y + v[i]); }, [0, 0, 0]);
  rows.push({ c: ['직접공사비 계', '', '', null, null, null, null, null, null, null, { f: 'SUBTOTAL(9,K{first}:K{prev})', v: all[0] }, { f: 'SUBTOTAL(9,L{first}:L{prev})', v: all[1] }, { f: 'SUBTOTAL(9,M{first}:M{prev})', v: all[2] }], style: 'total' });
  return { name: '기성내역서', title: o.title, sub: o.sub, cols, rows };
}

/* ---------- 차수별 내역서 ---------- */
export function phaseXSheet(o: { title: string; sub: string; lines: Line[]; names: string[]; qty: (i: number, id: string) => number }): XSheet {
  const n = o.names.length;
  const qc = (i: number) => colL(7 + i), ac = (i: number) => colL(7 + n + i);
  const cols: XCol[] = [{ h: '공종명', w: 34 }, { h: '규격', w: 18 }, { h: '단위', w: 6, align: 'center' }, { h: '도급 수량', w: 11, fmt: NQ },
    { h: '재료비 단가', w: 12, fmt: N0 }, { h: '노무비 단가', w: 12, fmt: N0 }, { h: '경비 단가', w: 12, fmt: N0 },
    ...o.names.map((x) => ({ h: `${x} 수량`, w: 11, fmt: NQ })), ...o.names.map((x) => ({ h: `${x} 금액`, w: 15, fmt: N0 })), { h: '미배정 수량', w: 11, fmt: NQ }];
  const rows: XRow[] = [];
  const sumOf = (l: Line, f: (x: Line) => number) => { let s = 0; const w = (ls: Line[]) => ls.forEach((x) => (x.children ? w(x.children) : (s += f(x)))); w([l]); return s; };
  for (const r of tree(o.lines)) {
    const l = r.line;
    if (l.children) {
      rows.push({ c: [l.name, '', '', null, null, null, null, ...o.names.map(() => null), ...o.names.map((_, i) => groupF(ac(i), sumOf(l, (x) => amt3(o.qty(i, x.id), x)))), null], style: r.depth === 0 ? 'g0' : 'g1', indent: r.depth, span: r.span });
      continue;
    }
    const qs = o.names.map((_, i) => o.qty(i, l.id));
    const rest = Math.round((l.qty - qs.reduce((a, b) => a + b, 0)) * 1000) / 1000;
    rows.push({ c: [l.name, l.spec, l.unit, l.qty, l.mu, l.lu, l.eu, ...qs.map((v) => v || null), ...qs.map((v, i) => ({ f: fAmt(qc(i), 'E', 'F', 'G'), v: amt3(v, l) })),
      { f: `D{r}-${o.names.map((_, i) => `${qc(i)}{r}`).join('-')}`, v: rest }], indent: r.depth });
  }
  rows.push({ c: ['직접공사비 계', '', '', null, null, null, null, ...o.names.map(() => null), ...o.names.map((_, i) => ({ f: `SUBTOTAL(9,${ac(i)}{first}:${ac(i)}{prev})`, v: o.lines.reduce((s, l) => s + sumOf(l, (x) => amt3(o.qty(i, x.id), x)), 0) })), null], style: 'total' });
  return { name: '차수별 내역서', title: o.title, sub: o.sub, cols, rows };
}

/* ---------- 하도급내역서 ---------- */
export function subXSheet(o: { title: string; sub: string; target: Line[]; rate: number }): XSheet {
  // A 공종명 · B 규격 · C 단위 · D 수량 · E/F/G 도급 단가 · H/I/J 하도급 단가 · K 도급 금액 · L 하도급 금액
  const rt = String(+o.rate.toFixed(6));
  const cols: XCol[] = [{ h: '공종명', w: 34 }, { h: '규격', w: 18 }, { h: '단위', w: 6, align: 'center' }, { h: '수량', w: 11, fmt: NQ },
    { h: '도급 재료비', w: 12, fmt: N0 }, { h: '도급 노무비', w: 12, fmt: N0 }, { h: '도급 경비', w: 12, fmt: N0 },
    { h: '하도급 재료비', w: 12, fmt: N0 }, { h: '하도급 노무비', w: 12, fmt: N0 }, { h: '하도급 경비', w: 12, fmt: N0 },
    { h: '도급 금액', w: 15, fmt: N0 }, { h: '하도급 금액', w: 15, fmt: N0 }];
  const sl = (l: Line): Line => ({ ...l, mu: fl(l.mu * o.rate), lu: fl(l.lu * o.rate), eu: fl(l.eu * o.rate) });
  const sumOf = (l: Line, f: (x: Line) => number) => { let s = 0; const w = (ls: Line[]) => ls.forEach((x) => (x.children ? w(x.children) : (s += f(x)))); w([l]); return s; };
  const rows: XRow[] = [];
  for (const r of tree(o.target)) {
    const l = r.line;
    if (l.children) { rows.push({ c: [l.name, '', '', null, null, null, null, null, null, null, groupF('K', lineAmount(l).t), groupF('L', sumOf(l, (x) => lineAmount(sl(x)).t))], style: r.depth === 0 ? 'g0' : 'g1', indent: r.depth, span: r.span }); continue; }
    const s = sl(l);
    rows.push({ c: [l.name, l.spec, l.unit, l.qty, l.mu, l.lu, l.eu, { f: `TRUNC(E{r}*${rt},0)`, v: s.mu }, { f: `TRUNC(F{r}*${rt},0)`, v: s.lu }, { f: `TRUNC(G{r}*${rt},0)`, v: s.eu },
      { f: fAmt('D', 'E', 'F', 'G'), v: lineAmount(l).t }, { f: fAmt('D', 'H', 'I', 'J'), v: lineAmount(s).t }], indent: r.depth });
  }
  rows.push({ c: ['직접공사비 계', '', '', null, null, null, null, null, null, null, { f: 'SUBTOTAL(9,K{first}:K{prev})', v: o.target.reduce((a, l) => a + lineAmount(l).t, 0) }, { f: 'SUBTOTAL(9,L{first}:L{prev})', v: o.target.reduce((a, l) => a + sumOf(l, (x) => lineAmount(sl(x)).t), 0) }], style: 'total' });
  return { name: '하도급내역서', title: o.title, sub: o.sub, cols, rows };
}
