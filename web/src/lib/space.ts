// 회사 공용공간 공통 (space-files 버킷)
import { sb, q } from './supabase';

export const SPACE = 'space-files';
export const KIND: Record<string, string> = { notice: '공지사항', memo: '전달사항' };
export const FOLDERS = ['홍보자료', '카탈로그', '기술자료', '양식함'] as const;
export const SUBFOLDERS: Record<string, string[]> = {
  홍보자료: ['회사소개서', '브로슈어', '사진', '영상'],
  카탈로그: ['제품', '특허공법'],
  기술자료: ['특허증', '시방서 · 절차서 · 상세도', '시험성적서', '시공사례'],
  양식함: ['인사 · 근태', '회계 · 지출', '현장', '기타'],
};
export const CATS: Record<string, string> = { 전사: '#1F4E8C', 교육: '#5B3A99', 현장: '#0F6E61', 마감: '#C62828', 회사: '#8A4B00' };

const safe = (n: string) => n.replace(/[^\w.\-가-힣]+/g, '_').slice(-80);
export async function spaceUpload(area: 'board' | 'library', file: File) {
  const { data } = await sb.auth.getUser();
  const path = `${area}/${data.user!.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${safe(file.name)}`;
  const { error } = await sb.storage.from(SPACE).upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name, size: file.size, mime: file.type };
}
export async function spaceDownload(path: string, name: string) {
  const { data, error } = await sb.storage.from(SPACE).download(path);
  if (error || !data) throw new Error(error?.message || '다운로드 실패');
  const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export async function spaceUrl(path: string) {
  const { data } = await sb.storage.from(SPACE).createSignedUrl(path, 3600);
  return data?.signedUrl || '';
}
export const kb = (n?: number | null) => (!n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
export const extOf = (n: string) => (n.match(/\.(\w+)$/)?.[1] || '').toUpperCase();
export const myPosts = (onlyVisible = true) => {
  let x = sb.from('posts').select('*, profiles:author_id(name, username)').order('pinned', { ascending: false }).order('publish_at', { ascending: false });
  if (onlyVisible) x = x.lte('publish_at', new Date().toISOString());
  return x;
};
export async function myReads() { const { data } = await sb.auth.getUser(); return q<any[]>(sb.from('post_reads').select('*').eq('user_id', data.user!.id)); }
