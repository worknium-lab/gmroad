// 회의록 시작: 회의 정보 → 지금 녹음 / 녹음파일 / 수기 스캔 · 사진 / 태블릿 노트 / 메모
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../lib/auth';
import { Modal, FileDrop, Seg, useToast } from '../../../lib/ui';
import { MEETING_KINDS, Meeting, Attendee, createMeeting, attachAudio, attachPages, patchMeeting, startProcess, useRecorder, mmss } from '../../../lib/meeting';

export type Way = 'rec' | 'file' | 'hand' | 'note' | 'memo';
const WAYS: [Way, string, string][] = [
  ['rec', '지금 녹음', '이 기기 마이크로 회의를 녹음합니다. 끝나면 받아쓰기 · 요약이 자동으로 만들어집니다.'],
  ['file', '녹음파일 올리기', '휴대폰 · 녹음기로 녹음한 파일(m4a · mp3 · wav)을 올립니다.'],
  ['hand', '수기 스캔 · 사진', '손으로 쓴 회의록을 찍거나 스캔해서 올리면 글자로 옮기고 정리합니다.'],
  ['note', '태블릿 노트', '아이패드 · 갤럭시탭에서 펜으로 필기하면서 녹음합니다.'],
  ['memo', '메모만', '키보드로 바로 적습니다.'],
];
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export default function MeetingStart({ pid, members, way: way0, onClose, onDone }: { pid: string; members: any[]; way?: Way; onClose: () => void; onDone: (m: Meeting) => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const { profile } = useAuth();
  const [way, setWay] = useState<Way>(way0 || 'rec');
  const [f, setF] = useState({ title: '', held_at: localNow(), kind: '정례', place: '', agenda: '', note_text: '' });
  const [att, setAtt] = useState<Attendee[]>(() => (profile ? [{ name: profile.name || profile.username, org: '' }] : []));
  const [extra, setExtra] = useState({ name: '', org: '' });
  const [consent, setConsent] = useState(false);
  const [alertsOn, setAlertsOn] = useState(true);
  const [m, setM] = useState<Meeting | null>(null);
  const [busy, setBusy] = useState('');
  const r = useRecorder();
  const needsConsent = way === 'rec' || way === 'file' || way === 'note';

  const base = () => ({
    title: f.title.trim() || `${f.kind} 회의`, held_at: new Date(f.held_at).toISOString(), kind: f.kind, place: f.place || null, agenda: f.agenda || null, attendees: att,
    consent: needsConsent ? consent : false, consent_by: needsConsent && consent ? profile?.id : null, consent_at: needsConsent && consent ? new Date().toISOString() : null, alerts_on: alertsOn,
  });
  const ensure = async (): Promise<Meeting> => { if (m) return m; const x = await createMeeting(pid, base()); setM(x); return x; };
  const finish = async (x: Meeting, process = true) => {
    if (process) { try { await startProcess(x.id); } catch (e: any) { toast(e.message); } }
    onDone(x);
  };

  const recStart = async () => { await ensure(); await r.start(); };
  const recStop = async () => {
    setBusy('녹음 올리는 중…');
    try { const { blob, ext } = await r.stop(); const x = await attachAudio(await ensure(), blob, 'recording' + ext); await finish(x); }
    catch (e: any) { toast('올리기 실패: ' + e.message + ' — 인터넷 연결을 확인하고 다시 시도하세요'); }
    setBusy('');
  };
  const audioFile = async (files: File[]) => {
    const file = files[0]; if (!file) return;
    if (file.size > 500 * 1024 * 1024) return toast('500MB보다 큰 파일은 올릴 수 없습니다');
    setBusy(`올리는 중… (${Math.round(file.size / 1024 / 1024)}MB)`);
    try { const x = await attachAudio(await ensure(), file, file.name); await finish(x); } catch (e: any) { toast('올리기 실패: ' + e.message); }
    setBusy('');
  };
  const pageFiles = async (files: File[]) => {
    const imgs = files.filter((x) => x.type.startsWith('image/'));
    if (!imgs.length) return toast('사진 · 스캔 이미지(jpg · png)를 올려 주세요. PDF는 사진으로 찍어 올려 주세요');
    setBusy(`${imgs.length}쪽 올리는 중…`);
    try { const x = await attachPages(await ensure(), imgs, 'hand'); await finish(x); } catch (e: any) { toast('올리기 실패: ' + e.message); }
    setBusy('');
  };
  const memo = async () => {
    setBusy('저장 중…');
    try { const x = await ensure(); const y = await patchMeeting(x.id, { note_text: f.note_text, methods: [] }); await finish(y, !!f.note_text.trim()); } catch (e: any) { toast(e.message); }
    setBusy('');
  };
  const note = async () => { const x = await ensure(); nav(`/projects/${pid}/meeting?note=${x.id}`); onClose(); };

  const close = () => { if (r.state !== 'idle' && !confirm('녹음 중입니다. 녹음을 버리고 닫을까요?')) return; if (r.state !== 'idle') r.stop(); onClose(); };
  const addAtt = (a: Attendee) => { if (a.name.trim() && !att.some((x) => x.name === a.name)) setAtt([...att, a]); };
  const ready = !needsConsent || consent;

  return (
    <Modal title="회의 기록 시작" onClose={close} wide>
      <div className="grid" style={{ gridTemplateColumns: '2fr 1.2fr 1fr 1.2fr', gap: 10 }}>
        <div className="field"><label htmlFor="mt1">회의명</label><input id="mt1" className="input" placeholder="예: 주간 공정회의" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} disabled={!!m} /></div>
        <div className="field"><label htmlFor="mt2">일시</label><input id="mt2" className="input" type="datetime-local" value={f.held_at} onChange={(e) => setF({ ...f, held_at: e.target.value })} disabled={!!m} /></div>
        <div className="field"><label htmlFor="mt3">구분</label><select id="mt3" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} disabled={!!m}>{MEETING_KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="field"><label htmlFor="mt4">장소</label><input id="mt4" className="input" placeholder="현장 사무실" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} disabled={!!m} /></div>
      </div>
      <div className="field"><span>참석자 <span className="muted">— 받아쓰기에서 말한 사람 이름을 맞출 때와 할 일 담당자를 정할 때 씁니다</span></span>
        <div className="row">
          {att.map((a) => <span key={a.name} className="pill blue">{a.name}{a.org ? ` · ${a.org}` : ''} {!m && <button className="link" aria-label={a.name + ' 빼기'} onClick={() => setAtt(att.filter((x) => x !== a))} style={{ border: 0, background: 'none', cursor: 'pointer' }}>✕</button>}</span>)}
        </div>
        {!m && <div className="row">
          <select className="input" style={{ width: 200 }} value="" onChange={(e) => { const p = members.find((x) => x.id === e.target.value); if (p) addAtt({ name: p.name || p.username, org: '' }); }} aria-label="직원 추가">
            <option value="">+ 프로젝트 참여자</option>{members.map((p) => <option key={p.id} value={p.id}>{p.name || p.username}</option>)}</select>
          <input className="input" style={{ width: 120 }} placeholder="이름" value={extra.name} onChange={(e) => setExtra({ ...extra, name: e.target.value })} aria-label="외부 참석자 이름" />
          <input className="input" style={{ width: 140 }} placeholder="소속 (감리단 등)" value={extra.org} onChange={(e) => setExtra({ ...extra, org: e.target.value })} aria-label="외부 참석자 소속" />
          <button className="btn sm" onClick={() => { addAtt(extra); setExtra({ name: '', org: '' }); }} disabled={!extra.name.trim()}>추가</button>
        </div>}
      </div>
      <div className="field"><label htmlFor="mt5">안건 (선택)</label><textarea id="mt5" className="input" rows={2} value={f.agenda} onChange={(e) => setF({ ...f, agenda: e.target.value })} disabled={!!m} placeholder="한 줄에 하나씩" /></div>

      <Seg label="기록 방법" value={way} onChange={(v) => r.state === 'idle' && !busy && setWay(v)} items={WAYS.filter(([k]) => k !== 'note' || profile?.role !== 'field').map(([k, l]) => [k, l])} />
      <div className="muted">{WAYS.find((x) => x[0] === way)![2]}</div>

      {needsConsent && <label className="row" style={{ gap: 8, minHeight: 44 }}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 22, height: 22 }} disabled={!!m && m.consent} />
        참석자에게 녹음한다는 사실을 알렸습니다 <span className="muted">(기록이 남습니다)</span></label>}

      {way === 'rec' && (
        <div className="rec-box">
          <div className="rec-time" aria-live="polite">{r.state === 'idle' ? '0:00' : mmss(r.secs)}</div>
          <div className="rec-level" aria-hidden><i style={{ width: Math.min(100, r.level * 180) + '%' }} /></div>
          <div className="row">
            {r.state === 'idle' && !busy && <button className="btn pri" style={{ background: 'var(--red-s)', borderColor: 'var(--red-s)', minWidth: 160 }} disabled={!ready} onClick={recStart}>● 녹음 시작</button>}
            {r.state === 'rec' && <button className="btn" onClick={r.pause}>일시정지</button>}
            {r.state === 'paused' && <button className="btn" onClick={r.resume}>이어서 녹음</button>}
            {r.state !== 'idle' && <button className="btn pri" onClick={recStop}>■ 회의 끝 · 정리하기</button>}
          </div>
          {r.state !== 'idle' && <div className="muted">녹음 중에는 이 화면을 닫지 마세요. 휴대폰은 화면이 꺼지지 않게 해 두는 것이 안전합니다.</div>}
          {r.error && <div className="banner red"><span>{r.error}</span></div>}
        </div>
      )}
      {way === 'file' && (ready ? <FileDrop accept="audio/*,video/mp4,.m4a,.mp3,.wav,.aac,.amr,.3gp" label={busy || '녹음파일을 끌어다 놓거나 눌러서 고르세요'} onFiles={audioFile} /> : <div className="muted">녹음 고지를 먼저 체크해 주세요.</div>)}
      {way === 'hand' && <FileDrop multiple capture accept="image/*" label={busy || '회의록 사진 · 스캔을 끌어다 놓거나 눌러서 찍으세요 (여러 쪽 가능)'} onFiles={pageFiles} />}
      {way === 'note' && <div className="row"><button className="btn pri" disabled={!ready} onClick={note}>노트 열기</button><span className="muted">태블릿을 가로로 두면 넓게 씁니다. 노트 안에서 녹음을 켜고 끌 수 있습니다.</span></div>}
      {way === 'memo' && <>
        <textarea className="input" rows={8} placeholder="회의 내용을 적으세요" value={f.note_text} onChange={(e) => setF({ ...f, note_text: e.target.value })} />
        <div className="row"><button className="btn pri" disabled={!!busy || !f.note_text.trim()} onClick={memo}>{busy || '저장하고 정리하기'}</button></div>
      </>}
      <label className="row" style={{ gap: 8, minHeight: 44 }}><input type="checkbox" checked={alertsOn} onChange={(e) => setAlertsOn(e.target.checked)} style={{ width: 20, height: 20 }} disabled={!!m} />
        확정하면 결정사항 · 기한 있는 할 일 · 미결 사항을 프로젝트 알림칸에 올리기</label>
      {busy && <div className="banner blue"><span>{busy}</span></div>}
    </Modal>
  );
}
