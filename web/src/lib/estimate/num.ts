/** "1,534" · "△7,951" · "" 같은 표기를 숫자로 */
export function parseNum(s: string | number | undefined | null): number {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const neg = s.includes('△') || s.trim().startsWith('-');
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return neg ? -v : v;
}

/** 원 단위 표기. 0은 빈칸으로. 음수는 △로 (내역서 관례) */
export function won(v: number | null | undefined, opts: { zero?: string; tri?: boolean } = {}): string {
  if (v === null || v === undefined) return '';
  if (v === 0) return opts.zero ?? '';
  const s = Math.abs(v).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  if (v < 0) return (opts.tri === false ? '-' : '△') + s;
  return s;
}

export function qtyFmt(v: number): string {
  if (!v) return '';
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
}

export const floor = (v: number) => Math.floor(v + 1e-9);

export function pct(a: number, b: number, digits = 3): string {
  if (!b) return '';
  return ((a / b) * 100).toFixed(digits) + '%';
}
