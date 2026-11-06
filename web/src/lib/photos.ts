import { sb, q } from './supabase';
import { upload, compressImage } from './files';

export type Photo = {
  id: string; project_id: string; storage_path: string; kind: string; memo: string | null; caption: string | null;
  taken_at: string; taken_day: string; lat: number | null; lng: number | null; location_id: string | null; work_item_id: string | null;
  uploaded_by: string | null; created_at: string; thumb_path: string | null; width: number | null; height: number | null;
  profiles?: { name: string | null; username: string } | null;
};

import { readExif } from './exif';
export { readExif };

async function imageSize(b: Blob): Promise<{ w: number; h: number } | null> {
  // 저장본은 긴 변 2000px로 줄어드므로 그 크기로 기록
  try { const bmp = await createImageBitmap(b); const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)); const r = { w: Math.round(bmp.width * s), h: Math.round(bmp.height * s) }; bmp.close?.(); return r; } catch { return null; }
}

/* ---------- 올리기 (3장씩 동시에, 실패한 것만 다시) ---------- */
export type Tags = { kind: string; location_id: string; work_item_id: string; memo: string };
export type UpItem = { file: File; state: 'wait' | 'up' | 'done' | 'fail'; err?: string };

/** 사진 1장: 원본(긴 변 2000px) + 목록용 작은 사진(480px) 올리고, photos 행에 넣을 값을 돌려줌 */
export async function preparePhoto(pid: string, file: File, gps?: { lat: number; lng: number } | null) {
  const ex = await readExif(file);
  const taken = ex.taken || new Date(file.lastModified || Date.now());
  const day = ymd(taken);
  const { path } = await upload(pid, 'photos/' + day, file, file.name, true);
  let thumb_path: string | null = null;
  try { const t = await compressImage(file, 480); if (t !== file) thumb_path = (await upload(pid, 'photos/' + day + '/thumb', t, file.name.replace(/\.\w+$/, '') + '.jpg')).path; } catch { /* 작은 사진은 없어도 됨 */ }
  const size = await imageSize(file);
  return { storage_path: path, thumb_path, taken_at: taken.toISOString(), lat: ex.lat ?? gps?.lat ?? null, lng: ex.lng ?? gps?.lng ?? null, width: size?.w ?? null, height: size?.h ?? null };
}

export async function uploadPhotos(pid: string, uid: string, items: UpItem[], tags: Tags, gps: { lat: number; lng: number } | null, onChange: () => void) {
  let i = 0;
  const work = async () => {
    while (i < items.length) {
      const it = items[i++];
      if (it.state === 'done') continue;
      it.state = 'up'; onChange();
      try {
        const f = await preparePhoto(pid, it.file, gps);
        await q(sb.from('photos').insert({
          project_id: pid, kind: tags.kind, location_id: tags.location_id || null, work_item_id: tags.work_item_id || null, memo: tags.memo || null,
          uploaded_by: uid, ...f,
        }));
        it.state = 'done';
      } catch (e: any) { it.state = 'fail'; it.err = e.message; }
      onChange();
    }
  };
  await Promise.all([work(), work(), work()]);
}

/* ---------- 날짜 · 문구 ---------- */
export const ymd = (d: Date) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const dayLabel = (s: string) => { const [y, m, d] = s.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return `${y}년 ${m}월 ${d}일 (${WD[w]})`; };
export const dayShort = (s: string) => { const [, m, d] = s.split('-').map(Number); return `${m}.${d}`; };
export const hm = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

export function groupByDay(ps: Photo[]): [string, Photo[]][] {
  const m = new Map<string, Photo[]>();
  for (const p of ps) { const k = p.taken_day; if (!m.has(k)) m.set(k, []); m.get(k)!.push(p); }
  return [...m.entries()];
}

/** 사진대지 '내용' 칸 기본값: 사진 설명 → 없으면 구분 · 메모 (위치 · 공종 · 일자는 따로 칸이 있음) */
export const autoCaption = (p: Photo) => p.caption || [p.kind, p.memo].filter(Boolean).join(' · ');
