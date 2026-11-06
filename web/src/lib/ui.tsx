import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { signedUrls } from './files';

/* ---------- 토스트 ---------- */
const T = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(T);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<any>();
  const show = useCallback((m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 2600); }, []);
  return <T.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</T.Provider>;
}

/* ---------- 데이터 불러오기 ---------- */
export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fn()); } catch (e: any) { setError(e.message || String(e)); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

export function useSigned(paths: (string | null | undefined)[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.filter(Boolean).join('|');
  useEffect(() => { if (key) signedUrls(key.split('|')).then(setUrls).catch(() => {}); }, [key]);
  return urls;
}

/* ---------- 부품 ---------- */
export const Loading = () => <div className="spin">불러오는 중…</div>;
export const ErrorBox = ({ msg }: { msg: string }) => <div className="banner red">오류: {msg}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Pill = ({ c, children }: { c?: string; children: ReactNode }) => <span className={'pill ' + (c || '')}>{children}</span>;
export const Bar = ({ v, teal }: { v: number; teal?: boolean }) => <span className={'bar' + (teal ? ' teal' : '')}><i style={{ width: Math.max(0, Math.min(100, v)) + '%' }} /></span>;

export function Modal({ title, onClose, children, foot, wide }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 960 } : undefined}>
        <div className="card-h"><h2>{title}</h2><button className="btn sm" onClick={onClose} aria-label="닫기">✕</button></div>
        {children}
        {foot && <div className="foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: [T, string][]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map(([v, l]) => <button key={v} type="button" aria-pressed={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function FileDrop({ onFiles, multiple, accept, label, capture }: { onFiles: (f: File[]) => void; multiple?: boolean; accept?: string; label: string; capture?: boolean }) {
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={'drop' + (on ? ' on' : '')} role="button" tabIndex={0}
      onClick={() => ref.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOn(true); }} onDragLeave={() => setOn(false)}
      onDrop={(e) => { e.preventDefault(); setOn(false); onFiles(Array.from(e.dataTransfer.files)); }}>
      {label}
      <input ref={ref} type="file" hidden multiple={multiple} accept={accept} {...(capture ? { capture: 'environment' } : {})}
        onChange={(e) => { onFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
    </div>
  );
}
