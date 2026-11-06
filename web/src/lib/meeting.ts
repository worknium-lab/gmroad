// 회의록 공통: 만들기 · 녹음 · 올리기 · 정리 시작
import { useEffect, useRef, useState } from 'react';
import { api, q, sb } from './supabase';
import { compressImage, upload } from './files';

export const MEETING_KINDS = ['정례', '감리 협의', '발주처', '협력사', '내부', '기타'];
export const METHOD: Record<string, [string, string]> = { rec: ['녹음', 'blue'], hand: ['수기 스캔', 'orange'], note: ['태블릿 노트', 'purple'] };
export const MSTATUS: Record<string, [string, string]> = {
  draft: ['작성 중', ''], processing: ['정리 중', 'orange'], transcribed: ['받아쓰기 완료', 'blue'],
  summarized: ['요약 완료 · 검토 전', 'blue'], reviewed: ['확정', 'green'], error: ['오류', 'red'],
};
export type Attendee = { name: string; org?: string };
export type Seg = { start: number; end: number; speaker: string | null; text: string };
export type Page = { path: string; kind: 'hand' | 'note'; text?: string; unsure?: string[]; strokes_path?: string; manual?: boolean };
export type Meeting = {
  id: string; project_id: string; title: string; held_at: string; kind: string; place?: string; attendees: Attendee[]; agenda?: string; methods: string[];
  status: string; progress?: string; error?: string; consent: boolean; audio_path?: string; audio_seconds?: number; transcript: Seg[];
  summary: { one_line?: string; agenda?: { title: string; points: string[]; start?: number | null }[]; decisions?: string[]; open_issues?: string[] };
  pages: Page[]; note_text?: string; alerts_on: boolean; locked: boolean; confirmed_at?: string; created_by?: string; created_at: string;
  profiles?: { name?: string; username?: string };
};

export const mmss = (s?: number | null) => { const v = Math.max(0, Math.round(s || 0)); const h = Math.floor(v / 3600); const m = Math.floor((v % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(v % 60).padStart(2, '0'); };

export async function createMeeting(pid: string, x: Record<string, any>) {
  return q<Meeting>(sb.from('meetings').insert({ project_id: pid, ...x }).select().single());
}
export async function patchMeeting(id: string, x: Partial<Meeting> | Record<string, any>) {
  return q<Meeting>(sb.from('meetings').update({ ...x, updated_at: new Date().toISOString() }).eq('id', id).select().single());
}
export const startProcess = (id: string, opt: { retranscribe?: boolean; ocr?: boolean; skip_summary?: boolean } = {}) => api('/api/meetings/process', { meeting_id: id, ...opt });

export async function attachAudio(m: Meeting, blob: Blob, name = 'recording.webm') {
  const ext = (name.match(/\.\w+$/) || ['.webm'])[0];
  const { path } = await upload(m.project_id, `meetings/${m.id}`, blob, 'audio' + ext);
  return patchMeeting(m.id, { audio_path: path, methods: [...new Set([...(m.methods || []), 'rec'])] });
}
export async function attachPages(m: Meeting, files: (File | Blob)[], kind: 'hand' | 'note', extra: Partial<Page>[] = []) {
  const pages: Page[] = [...(m.pages || [])];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const body = kind === 'hand' && f instanceof File ? await compressImage(f, 2400) : f;
    const { path } = await upload(m.project_id, `meetings/${m.id}`, body, kind === 'note' ? `note_${i + 1}.png` : `page_${pages.length + 1}.jpg`);
    pages.push({ path, kind, ...(extra[i] || {}) });
  }
  return patchMeeting(m.id, { pages, methods: [...new Set([...(m.methods || []), kind])] });
}

/** 마이크 녹음 (MediaRecorder). 음성용으로 낮은 비트레이트 → 1시간 약 15MB */
export function useRecorder() {
  const [state, setState] = useState<'idle' | 'rec' | 'paused'>('idle');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0); const pausedAt = useRef(0); const pausedTotal = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number>(0);
  const wake = useRef<any>(null);
  const elapsed = () => (state === 'idle' && !started.current ? 0 : ((pausedAt.current || Date.now()) - started.current - pausedTotal.current) / 1000);

  useEffect(() => {
    if (state !== 'rec') return;
    const t = setInterval(() => setSecs(elapsed()), 500);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => () => { cancelAnimationFrame(raf.current); stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  const start = async () => {
    setError('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      stream.current = s;
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t));
      const r = new MediaRecorder(s, { mimeType: type, audioBitsPerSecond: 32000 });
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.start(5000);
      rec.current = r; started.current = Date.now(); pausedTotal.current = 0; pausedAt.current = 0;
      setState('rec'); setSecs(0);
      try { wake.current = await (navigator as any).wakeLock?.request('screen'); } catch { /* 화면 꺼짐 방지 실패해도 녹음은 계속 */ }
      // 소리 크기 표시
      const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); setLevel(m / 128); raf.current = requestAnimationFrame(tick); };
      tick();
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? '마이크 사용을 허락해 주세요 (브라우저 주소창 옆 자물쇠 › 마이크)' : '녹음을 시작할 수 없습니다: ' + (e?.message || e));
    }
  };
  const pause = () => { rec.current?.pause(); pausedAt.current = Date.now(); setState('paused'); };
  const resume = () => { rec.current?.resume(); pausedTotal.current += Date.now() - pausedAt.current; pausedAt.current = 0; setState('rec'); };
  const stop = () => new Promise<{ blob: Blob; ext: string; seconds: number }>((ok) => {
    const r = rec.current; if (!r) return;
    const seconds = elapsed();
    r.onstop = () => {
      cancelAnimationFrame(raf.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      try { wake.current?.release(); } catch { /* */ }
      const type = r.mimeType || 'audio/webm';
      setState('idle'); setLevel(0); started.current = 0;
      ok({ blob: new Blob(chunks.current, { type }), ext: type.includes('mp4') ? '.m4a' : type.includes('ogg') ? '.ogg' : '.webm', seconds });
    };
    r.stop();
  });
  /** 녹음 시작 후 지난 시간(ms) — 펜 노트 획에 붙임 */
  const now = () => (started.current ? Math.round(elapsed() * 1000) : null);
  return { state, secs, level, error, start, pause, resume, stop, now };
}
