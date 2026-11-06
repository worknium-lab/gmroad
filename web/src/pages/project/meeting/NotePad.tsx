// 태블릿 회의 노트 (가로 화면): 펜 · 형광펜 · 지우개 · 색 · 쪽 · 도면 위 필기 · 동시 녹음
// 획마다 녹음 시각을 붙여 두어, 나중에 글씨를 누르면 그때 발언이 재생됩니다.
import { useEffect, useRef, useState } from 'react';
import { upload } from '../../../lib/files';
import { useToast } from '../../../lib/ui';
import { Meeting, attachAudio, patchMeeting, startProcess, useRecorder, mmss } from '../../../lib/meeting';

type Stroke = { tool: 'pen' | 'hl'; color: string; w: number; p: [number, number, number][]; t: number | null };
type PageData = { bg?: string; strokes: Stroke[] };
const W = 1600, H = 1131;                                  // A4 가로 비율
const COLORS = ['#1A2233', '#1F4E8C', '#C62828', '#0F6E4A'];
const SIZES: [string, number][] = [['가늘게', 2.2], ['보통', 3.6], ['굵게', 6]];

export default function NotePad({ m, onClose }: { m: Meeting; onClose: (saved: boolean) => void }) {
  const toast = useToast();
  const key = 'gm.note.' + m.id;
  const [pages, setPages] = useState<PageData[]>(() => { try { return JSON.parse(localStorage.getItem(key) || '') || [{ strokes: [] }]; } catch { return [{ strokes: [] }]; } });
  const [pi, setPi] = useState(0);
  const [tool, setTool] = useState<'pen' | 'hl' | 'eraser'>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(1);
  const [finger, setFinger] = useState(true);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [saving, setSaving] = useState('');
  const cv = useRef<HTMLCanvasElement>(null);
  const cur = useRef<Stroke | null>(null);
  const penSeen = useRef(false);
  const bgImgs = useRef<Record<string, HTMLImageElement>>({});
  const r = useRecorder();
  const page = pages[pi];

  // 저장 전 내용은 이 기기에 계속 보관 (배터리 · 새로고침 대비)
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(pages)); } catch { /* 용량 초과 시 무시 */ } }, [pages]);
  useEffect(() => { draw(); }, [pages, pi]);

  const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    ctx.save();
    ctx.globalAlpha = s.tool === 'hl' ? 0.3 : 1; ctx.strokeStyle = s.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pts = s.p;
    if (s.tool === 'hl' && pts.length > 1) {          // 형광펜은 한 번에 그려야 겹친 곳이 진해지지 않음
      ctx.lineWidth = s.w * 6; ctx.beginPath(); ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
      for (const [x, y] of pts.slice(1)) ctx.lineTo(x * W, y * H);
      ctx.stroke(); ctx.restore(); return;
    }
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0, p0] = pts[i - 1], [x1, y1, p1] = pts[i];
      ctx.lineWidth = s.tool === 'hl' ? s.w * 6 : s.w * (0.6 + ((p0 + p1) / 2) * 0.9);
      ctx.beginPath(); ctx.moveTo(x0 * W, y0 * H); ctx.lineTo(x1 * W, y1 * H); ctx.stroke();
    }
    if (pts.length === 1) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(pts[0][0] * W, pts[0][1] * H, s.w / 2, 0, 7); ctx.fill(); }
    ctx.restore();
  };
  const render = (ctx: CanvasRenderingContext2D, pg: PageData, marks: boolean) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const img = pg.bg && bgImgs.current[pg.bg];
    if (img) { const s = Math.min(W / img.width, H / img.height); ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s); }
    else if (!pg.bg) { ctx.strokeStyle = '#E6EBF2'; ctx.lineWidth = 1; for (let y = 60; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke(); } }
    for (const s of pg.strokes) drawStroke(ctx, s);
    if (marks) {                                       // 줄 옆 녹음 시각
      ctx.fillStyle = '#1F4E8C'; ctx.font = '16px sans-serif';
      const seen = new Set<number>();
      for (const s of pg.strokes) if (s.t != null && s.p.length) { const row = Math.round((s.p[0][1] * H) / 48); if (seen.has(row)) continue; seen.add(row); ctx.fillText(mmss(s.t / 1000), 4, row * 48 + 6); }
    }
  };
  const draw = () => {
    const c = cv.current; if (!c) return;
    const pg = pages[pi];
    if (pg.bg && !bgImgs.current[pg.bg]) { const img = new Image(); img.onload = () => { bgImgs.current[pg.bg!] = img; draw(); }; img.src = pg.bg; }
    const ctx = c.getContext('2d')!;
    render(ctx, pg, true);
    if (cur.current?.tool === 'hl') drawStroke(ctx, cur.current);
  };

  const pos = (e: React.PointerEvent): [number, number, number] => {
    const b = cv.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)), e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5];
  };
  const eraseAt = (x: number, y: number) => {
    const rad = 0.012;
    const keep = page.strokes.filter((s) => !s.p.some((pt) => Math.hypot(pt[0] - x, (pt[1] - y) * (H / W)) < rad));
    if (keep.length !== page.strokes.length) setPages(pages.map((p, k) => (k === pi ? { ...p, strokes: keep } : p)));
  };
  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') penSeen.current = true;
    if (e.pointerType === 'touch' && (penSeen.current || !finger)) return;   // 펜을 쓰면 손바닥 터치는 무시
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = pos(e);
    if (tool === 'eraser') { eraseAt(p[0], p[1]); cur.current = { tool: 'pen', color: '', w: 0, p: [], t: null }; return; }
    cur.current = { tool, color, w: SIZES[size][1], p: [p], t: r.now() };
  };
  const move = (e: React.PointerEvent) => {
    const s = cur.current; if (!s) return;
    const p = pos(e);
    if (tool === 'eraser') return eraseAt(p[0], p[1]);
    const evs = (e.nativeEvent as any).getCoalescedEvents?.() || [e.nativeEvent];
    const ctx = cv.current!.getContext('2d')!;
    for (const ev of evs) {
      const b = cv.current!.getBoundingClientRect();
      const q: [number, number, number] = [(ev.clientX - b.left) / b.width, (ev.clientY - b.top) / b.height, ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5];
      s.p.push(q);
    }
    if (s.tool === 'hl') draw(); else drawStroke(ctx, { ...s, p: s.p.slice(-evs.length - 1) });
  };
  const up = () => {
    const s = cur.current; cur.current = null;
    if (!s || tool === 'eraser' || !s.p.length) return;
    setPages(pages.map((p, k) => (k === pi ? { ...p, strokes: [...p.strokes, s] } : p))); setRedo([]);
  };
  const undo = () => { const st = page.strokes; if (!st.length) return; setRedo([...redo, st[st.length - 1]]); setPages(pages.map((p, k) => (k === pi ? { ...p, strokes: st.slice(0, -1) } : p))); };
  const redoIt = () => { if (!redo.length) return; const s = redo[redo.length - 1]; setRedo(redo.slice(0, -1)); setPages(pages.map((p, k) => (k === pi ? { ...p, strokes: [...p.strokes, s] } : p))); };
  const loadBg = (f?: File) => {
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      // 큰 도면은 줄여서 보관
      const img = new Image(); img.onload = () => {
        const s = Math.min(1, 2000 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
        c.width = img.width * s; c.height = img.height * s; c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL('image/jpeg', 0.85);
        setPages([...pages.slice(0, pi + 1), { bg: url, strokes: [] }, ...pages.slice(pi + 1)]); setPi(pi + 1);
      }; img.src = rd.result as string;
    };
    rd.readAsDataURL(f);
  };

  const finish = async () => {
    if (!pages.some((p) => p.strokes.length || p.bg) && r.state === 'idle') { onClose(false); return; }
    setSaving('저장하는 중…');
    try {
      let mm = m;
      if (r.state !== 'idle') { setSaving('녹음 올리는 중…'); const { blob, ext } = await r.stop(); mm = await attachAudio(mm, blob, 'note' + ext); }
      const out = [...(mm.pages || [])];
      for (let k = 0; k < pages.length; k++) {
        const pg = pages[k]; if (!pg.strokes.length && !pg.bg) continue;
        setSaving(`노트 ${k + 1}/${pages.length}쪽 올리는 중…`);
        const c = document.createElement('canvas'); c.width = W; c.height = H; render(c.getContext('2d')!, pg, false);
        const png: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'));
        const { path } = await upload(m.project_id, `meetings/${m.id}`, png, `note_${k + 1}.png`);
        const sj = new Blob([JSON.stringify({ w: W, h: H, strokes: pg.strokes.map((s) => ({ ...s, p: s.p.map((x) => [+x[0].toFixed(4), +x[1].toFixed(4)]) })) })], { type: 'application/json' });
        const { path: sp } = await upload(m.project_id, `meetings/${m.id}`, sj, `note_${k + 1}.json`);
        out.push({ path, kind: 'note', strokes_path: sp });
      }
      mm = await patchMeeting(m.id, { pages: out, methods: [...new Set([...(mm.methods || []), 'note'])] });
      localStorage.removeItem(key);
      try { await startProcess(m.id); } catch (e: any) { toast(e.message); }
      onClose(true);
    } catch (e: any) { toast('저장 실패: ' + e.message + ' — 노트는 이 기기에 남아 있으니 다시 눌러 보세요'); setSaving(''); }
  };

  return (
    <div className="notepad" role="dialog" aria-label="태블릿 회의 노트">
      <div className="np-bar">
        <b style={{ marginRight: 8 }}>{m.title}</b>
        {[['pen', '펜'], ['hl', '형광펜'], ['eraser', '지우개']].map(([k, l]) => <button key={k} className={tool === k ? 'on' : ''} onClick={() => setTool(k as any)}>{l}</button>)}
        {COLORS.map((c) => <button key={c} className={'sw' + (color === c ? ' on' : '')} style={{ background: c }} aria-label={'색 ' + c} onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }} />)}
        {SIZES.map(([l], k) => <button key={l} className={size === k ? 'on' : ''} onClick={() => setSize(k)}>{l}</button>)}
        <button onClick={undo} aria-label="되돌리기">↶</button><button onClick={redoIt} aria-label="다시">↷</button>
        <button onClick={() => setFinger(!finger)} className={finger ? 'on' : ''} title="펜이 없으면 손가락으로 씁니다">손가락</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => setPi(Math.max(0, pi - 1))} disabled={pi === 0} aria-label="이전 쪽">‹</button>
        <span>{pi + 1}/{pages.length}</span>
        <button onClick={() => setPi(Math.min(pages.length - 1, pi + 1))} disabled={pi === pages.length - 1} aria-label="다음 쪽">›</button>
        <button onClick={() => { setPages([...pages, { strokes: [] }]); setPi(pages.length); }}>+ 쪽</button>
        <label className="btnlike">도면 불러오기<input type="file" accept="image/*" hidden onChange={(e) => loadBg(e.target.files?.[0])} /></label>
        {r.state === 'idle' && <button onClick={r.start} disabled={!m.consent} title={m.consent ? '' : '녹음 고지를 체크한 회의만 녹음할 수 있습니다'}>● 녹음</button>}
        {r.state !== 'idle' && <button className="on" style={{ color: '#C62828' }} onClick={r.state === 'rec' ? r.pause : r.resume}>{r.state === 'rec' ? '● ' : '‖ '}{mmss(r.secs)}</button>}
        <button className="on" onClick={finish} disabled={!!saving}>{saving || '회의 종료 · 정리'}</button>
        <button onClick={() => { if (confirm('저장하지 않고 닫을까요? (이 기기에는 남아 있어 다음에 이어 쓸 수 있습니다)')) { if (r.state !== 'idle') r.stop(); onClose(false); } }}>닫기</button>
      </div>
      {r.error && <div className="banner red" style={{ margin: 8 }}><span>{r.error}</span></div>}
      <div className="np-stage">
        <canvas ref={cv} width={W} height={H} style={{ width: 'min(100%, calc((100vh - 110px) * 1.414))', cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()} />
      </div>
    </div>
  );
}
