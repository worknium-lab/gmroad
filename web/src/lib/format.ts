export const won = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '-' : Math.trunc(Number(n)).toLocaleString('ko-KR'));
export const eok = (n: number | null | undefined) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e8) return (Math.trunc(v / 1e6) / 100).toLocaleString('ko-KR') + '억';
  if (Math.abs(v) >= 1e4) return Math.trunc(v / 1e4).toLocaleString('ko-KR') + '만';
  return v.toLocaleString('ko-KR');
};
export const qty = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = Number(n);
  return Number.isInteger(v) ? v.toLocaleString('ko-KR') : v.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
};
export const pct = (n: number | string | null | undefined) => (n === null || n === undefined ? '-' : Number(n).toFixed(1) + '%');
/** 금액 계산 규칙: TRUNC(A*B, 0) */
export const mul = (a: number, b: number) => Math.trunc(Number(a || 0) * Number(b || 0));
export const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const W = ['일', '월', '화', '수', '목', '금', '토'];
export const dateK = (s?: string | null) => { if (!s) return '-'; const d = new Date(s.length === 10 ? s + 'T00:00:00' : s); return `${d.getMonth() + 1}/${d.getDate()} (${W[d.getDay()]})`; };
export const dt = (s?: string | null) => { if (!s) return '-'; const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const period = (a?: string | null, b?: string | null) => (a || b ? `${(a || '').replace(/-/g, '.')} ~ ${(b || '').replace(/-/g, '.')}` : '-');
export const ROLE: Record<string, string> = { system_admin: '시스템 관리자', company_admin: '회사 관리자', staff: '본사 직원', field: '현장 담당자', viewer: '조회 전용' };
export const STATUS: Record<string, string> = { planned: '준비', active: '진행 중', done: '완료', hold: '보류' };
export const REPORT: Record<string, [string, string]> = { draft: ['작성 중', 'orange'], submitted: ['제출', 'green'], confirmed: ['본사 확인', 'blue'], returned: ['수정 요청', 'red'] };
export const REQ: Record<string, [string, string]> = { open: ['응답 대기', 'orange'], in_progress: ['진행 중', 'blue'], done: ['완료', 'green'] };
export const DOC: Record<string, string> = { design_spec: '설계서', design_boq: '설계내역서', qty_calc: '수량산출서', drawing: '설계도면', contract: '계약서류', construction: '공사서류' };
export const PHOTO_KINDS = ['시공 전', '시공 중', '시공 후', '자재 · 송장', '안전', '기타'];
