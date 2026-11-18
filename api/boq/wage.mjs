// 노임 일괄 갱신 — 설계내역서 엑셀의 노임 단가 칸만 새 값으로 바꾸고, 호표 → 내역 → 원가계산서는 엑셀 수식대로 다시 계산
//   바꿀 수 있는 칸: 기준 엑셀에서 '노임' 표로 찾은 단가 칸 중 값(수식 아님)인 칸만 (collectRefs의 labor)
//   새 파일 = 원본 + 바뀐 칸 + 다시 계산한 저장값 (엑셀이 열 때 전체 다시 계산)
import { readWorkbook, patchWorkbook } from './xlsx.mjs';
import { Evaluator } from './evaluator.mjs';
import { parseBoq } from './detect.mjs';
import { collectRefs, parseSheetRef } from './refs.mjs';
import { changedValues } from './contract.mjs';

export async function buildWageUpdate(buf, { sheet, headerRow, wages }) {
  const model = await readWorkbook(buf);
  const ev = new Evaluator(model);
  const before = parseBoq(model, ev, sheet, headerRow);
  const { prices } = collectRefs(model, ev, [sheet]);
  const allowed = new Map(prices.filter((p) => p.kind === 'labor' && p.price?.f).map((p) => [p.price.f, p]));
  const edits = {};
  const changed = [], skipped = [];
  for (const w of wages || []) {
    const p = allowed.get(w.f);
    const v = Math.trunc(Number(w.v));
    if (!p) { skipped.push({ f: w.f, why: '노임 단가 칸이 아닙니다' }); continue; }
    if (!(v > 0 && v < 1e8)) { skipped.push({ f: w.f, name: p.name, why: '단가가 이상합니다' }); continue; }
    const ref = parseSheetRef(w.f);
    if (!ref) { skipped.push({ f: w.f, name: p.name, why: '칸 주소를 읽지 못했습니다' }); continue; }
    if (ev.formula(ref.sheet, ref.a)) { skipped.push({ f: w.f, name: p.name, why: '수식 칸이라 바꾸지 않았습니다' }); continue; }
    const old = ev.num(ref.sheet, ref.a);
    if (old === v) continue;
    (edits[ref.sheet] ||= {})[ref.a] = { value: v };
    ev.set(ref.sheet, ref.a, { v });
    changed.push({ f: w.f, name: p.name, old, new: v });
  }
  const after = parseBoq(model, ev, sheet, headerRow);
  const bm = new Map(before.items.map((x) => [x.row, x]));
  const total = (P, k) => (P.totals[k] ? P.items.find((x) => x.row === P.totals[k].row)?.total_amt ?? null : null);
  const keys = ['direct', 'net', 'contract', 'grand'];
  const result = {
    changed, skipped,
    before: Object.fromEntries(keys.map((k) => [k, total(before, k)])),
    after: Object.fromEntries(keys.map((k) => [k, total(after, k)])),
    items: after.items.filter((it) => it.section === 'detail' && (it.kind === 'item' || it.kind === 'link') && Math.abs((it.total_amt || 0) - (bm.get(it.row)?.total_amt || 0)) > 0.5).length,
  };
  return { after, result, makeFile: () => patchWorkbook(buf, edits, changedValues(model, ev)) };
}
