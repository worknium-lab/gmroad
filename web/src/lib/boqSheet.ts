// 엑셀에서 가져온 내역서 항목(gm.boq_items) ↔ 적산 엔진(lib/estimate) 연결
//  - 엑셀 원본이 기준입니다. 엔진은 같은 규칙(비목별 수량 × 단가, 원 미만 버림)으로 다시 계산해 검산하고,
//    재료비 · 노무비 · 경비 합계를 냅니다.
import { lineAmount, type Amount, type Line, type Sheet } from './estimate';

export type BoqItem = {
  row: number; parent_row: number | null; level: number; kind: string; section: string;
  name: string; spec: string | null; unit: string | null; qty: number | string | null;
  mat_price: number | string | null; lab_price: number | string | null; exp_price: number | string | null;
  mat_amt: number | string; lab_amt: number | string; exp_amt: number | string; total_amt: number | string;
  price_ref?: string | null; orig?: any; change?: string | null;
};

const n = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const isLeaf = (i: BoqItem) => i.kind === 'item' || i.kind === 'link';

/** 한 항목을 엔진 줄로. 수량·단가가 없고 금액만 있는 줄(일식 등)은 수량 1 × 금액으로 둡니다. */
function leaf(i: BoqItem): Line {
  const hasPrice = i.qty !== null && i.qty !== undefined && (i.mat_price !== null || i.lab_price !== null || i.exp_price !== null);
  return {
    id: String(i.row), level: 0, mark: '', name: i.name, spec: i.spec || '', unit: i.unit || '',
    qty: hasPrice ? n(i.qty) : 1,
    mu: hasPrice ? n(i.mat_price) : n(i.mat_amt),
    lu: hasPrice ? n(i.lab_price) : n(i.lab_amt),
    eu: hasPrice ? n(i.exp_price) : n(i.exp_amt),
    ref: i.price_ref || undefined,
  };
}

/** 공종별 내역(detail) 항목을 엔진 내역서 트리로 */
export function toSheet(items: BoqItem[]): Sheet {
  // 공종 안의 금액 줄(잡비 % 등, kind = cost)도 소계에 들어가므로 금액 그대로 넣습니다
  const detail = items.filter((i) => i.section === 'detail' && (i.kind === 'group' || isLeaf(i) || (i.kind === 'cost' && i.parent_row != null)));
  const nodes = new Map<number, Line>();
  for (const i of detail) nodes.set(i.row, i.kind === 'group' ? { ...leaf(i), qty: 0, mu: 0, lu: 0, eu: 0, children: [] } : leaf(i));
  const roots: Line[] = [];
  for (const i of detail) {
    const node = nodes.get(i.row)!;
    const parent = i.parent_row != null ? nodes.get(i.parent_row) : undefined;
    if (parent?.children) parent.children.push(node); else roots.push(node);
  }
  return { sections: [{ section: 'main', lines: roots }] };
}

export type Check = { row: number; name: string; kind: string; excel: number; calc: number };

/** 엔진으로 다시 계산한 금액과 엑셀 금액 대조. 공종(소계) 줄과 항목 줄 모두 */
export function verify(items: BoqItem[]) {
  const sheet = toSheet(items);
  const calc = new Map<number, Amount>();
  const walk = (ls: Line[]) => { for (const l of ls) { calc.set(Number(l.id), lineAmount(l)); if (l.children) walk(l.children); } };
  walk(sheet.sections[0].lines);
  const diffs: Check[] = [];
  for (const i of items) {
    const a = calc.get(i.row);
    if (!a) continue;
    const excel = n(i.total_amt);
    if (Math.abs(a.t - excel) > 0.5) diffs.push({ row: i.row, name: i.name, kind: i.kind, excel, calc: a.t });
  }
  // 항목 줄이 먼저 (소계는 아래 항목이 틀리면 같이 틀리므로 뒤로)
  diffs.sort((x, y) => Number(x.kind === 'group') - Number(y.kind === 'group') || x.row - y.row);
  // 맨 위 공종 합 = 직접공사비 (재료 · 노무 · 경비)
  const direct = sheet.sections[0].lines.reduce<Amount>((s, l) => { const a = calc.get(Number(l.id))!; return { t: s.t + a.t, m: s.m + a.m, l: s.l + a.l, e: s.e + a.e }; }, { t: 0, m: 0, l: 0, e: 0 });
  return { checked: calc.size, diffs, direct, sheet };
}

/** 원가계산서(summary) 줄에서 이름으로 금액 찾기 */
export function summaryAmt(items: BoqItem[], re: RegExp): number | null {
  const it = items.find((i) => i.section === 'summary' && re.test((i.name || '').replace(/\s+/g, '')));
  return it ? n(it.total_amt) : null;
}

/** 단가 출처 수식을 짧게: "'일위대가목록'!$F$3" → "일위대가목록 F3" */
export function shortRef(f?: string | null): string {
  if (!f) return '';
  const m = f.replace(/^=/, '').match(/'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)/);
  if (m) return `${m[1]} ${m[2]}${m[3]}`;
  return f.length > 18 ? f.slice(0, 18) + '…' : f;
}
