import { sb, BUCKET } from './supabase';

/** 사진은 긴 변 2000px · JPEG 85%로 줄여서 올림 (현장 데이터 절약) */
export async function compressImage(file: File, max = 2000): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

/** 저장소 키는 영문 · 숫자만 됨 (수파베이스 저장소가 한글 키를 거부함). 보이는 이름은 DB에 따로 저장 */
export const safe = (n: string) => {
  const dot = n.lastIndexOf('.');
  const ext = dot > 0 ? n.slice(dot).replace(/[^A-Za-z0-9.]/g, '').slice(0, 10) : '';
  const base = (dot > 0 ? n.slice(0, dot) : n).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(-60);
  return (base || 'file') + ext;
};
/** 폴더 이름: 영문이면 그대로, 한글 등이 섞이면 짧은 고정 코드로 (예: docs/계약서 → docs/c_1k3z9q) */
const seg = (s: string) => /^[A-Za-z0-9._-]+$/.test(s) ? s : 'c_' + [...new TextEncoder().encode(s)].reduce((h, b) => Math.imul(h ^ b, 16777619) >>> 0, 2166136261).toString(36);
const safeFolder = (f: string) => f.split('/').filter(Boolean).map(seg).join('/');

/** 경로 규칙: {project_id}/{분류}/{시각}_{파일명} */
export async function upload(projectId: string, folder: string, file: File | Blob, name?: string, image = false) {
  const body = image && file instanceof File ? await compressImage(file) : file;
  const fname = safe(name || (file as File).name || 'file');
  const path = `${projectId}/${safeFolder(folder)}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${image ? fname.replace(/\.\w+$/, '.jpg') : fname}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, body, { contentType: image ? 'image/jpeg' : (file as File).type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return { path, size: body.size };
}

const cache = new Map<string, { url: string; exp: number }>();
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now(); const out: Record<string, string> = {}; const need: string[] = [];
  for (const p of paths.filter(Boolean)) { const c = cache.get(p); if (c && c.exp > now) out[p] = c.url; else need.push(p); }
  if (need.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    for (const d of data || []) if (d.signedUrl && d.path) { out[d.path] = d.signedUrl; cache.set(d.path, { url: d.signedUrl, exp: now + 3500_000 }); }
  }
  return out;
}

export async function download(path: string, fileName: string) {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message || '다운로드 실패');
  const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
