// 제품 · 실적 공통
import { sb, q } from './supabase';
import { compressImage, safe } from './files';
import { SPACE } from './space';

export type Product = {
  id: string; company_id: string; kind: '관급' | '사급'; category: string | null; name: string; spec: string | null; unit: string; price: number;
  maker: string | null; g2b_no: string | null; contract_no: string | null; contract_start: string | null; contract_end: string | null; g2b_url: string | null;
  note: string | null; active: boolean; created_at: string; updated_at: string;
  product_photos?: { id: string; storage_path: string; thumb_path: string | null; sort: number }[];
};
export type Delivery = {
  id: string; product_id: string; company_id: string; kind: '관급' | '사급'; delivered_on: string; project_id: string | null; project_name: string | null;
  client: string | null; contractor: string | null; qty: number; price: number; amount: number; note: string | null; created_at: string;
  products?: { name: string; spec: string | null; unit: string } | null;
};
export type Stat = { n: number; qty: number; amount: number; last_on: string | null };

export const UNITS = ['EA', '개', 'SET', '조', 'm', 'm²', 'm³', 'kg', 'ton', 'L', '식', '본', '매'];
export const CATEGORIES = ['교량받침', '신축이음', '보수 · 보강재', '배수시설', '방호시설', '도장재', '기타'];

/** 1억 2천 → '1.2억', 3,450만 → '3,450만' */
export function short(n: number) {
  n = Math.trunc(Number(n) || 0); const a = Math.abs(n);
  if (a >= 1e8) { const v = n / 1e8; return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, '')) + '억'; }
  if (a >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
  return n.toLocaleString('ko-KR');
}
export const daysLeft = (d: string | null) => (d ? Math.ceil((new Date(d + 'T23:59:59').getTime() - Date.now()) / 864e5) : null);

export async function loadStats(): Promise<Record<string, Stat>> {
  const rows = await q<any[]>(sb.from('v_product_stats').select('*'));
  return Object.fromEntries(rows.map((r) => [r.product_id, { n: r.n, qty: Number(r.qty), amount: Number(r.amount), last_on: r.last_on }]));
}

/** 제품 사진: 긴 변 1600px + 목록용 480px */
export async function addProductPhoto(productId: string, file: File, sort: number) {
  const base = `product/${productId}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${safe(file.name).replace(/\.\w+$/, '')}`;
  const big = await compressImage(file, 1600);
  const up = async (path: string, b: Blob) => { const { error } = await sb.storage.from(SPACE).upload(path, b, { contentType: 'image/jpeg' }); if (error) throw new Error(error.message); return path; };
  const storage_path = await up(base + '.jpg', big);
  let thumb_path: string | null = null;
  try { thumb_path = await up(base + '_t.jpg', await compressImage(file, 480)); } catch { /* 없어도 됨 */ }
  return q(sb.from('product_photos').insert({ product_id: productId, storage_path, thumb_path, sort }).select().single());
}

const urlCache = new Map<string, { url: string; exp: number }>();
export async function spaceUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now(); const out: Record<string, string> = {}; const need: string[] = [];
  for (const p of paths.filter(Boolean)) { const c = urlCache.get(p); if (c && c.exp > now) out[p] = c.url; else need.push(p); }
  if (need.length) {
    const { data } = await sb.storage.from(SPACE).createSignedUrls(need, 3600);
    for (const d of data || []) if (d.signedUrl && d.path) { out[d.path] = d.signedUrl; urlCache.set(d.path, { url: d.signedUrl, exp: now + 3500_000 }); }
  }
  return out;
}
