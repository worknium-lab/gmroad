import { useState } from 'react';
import { sb, q } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Project, Sub } from '../lib/data';
import { Modal, useToast } from '../lib/ui';
import { STATUS } from '../lib/format';

const num = (s: string) => Math.trunc(Number(String(s).replace(/[^\d-]/g, '')) || 0);

export default function ProjectForm({ project, onClose, onSaved }: { project?: Project; onClose: () => void; onSaved: (id: string) => void }) {
  const { companies, profile, company, isSys } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({
    company_id: project?.company_id || (company !== 'all' ? company : profile?.company_id) || companies[0]?.id || '',
    name: project?.name || '', client: project?.client || '', prime_contractor: project?.prime_contractor || '',
    prime_amount: project?.prime_amount ?? 0, start_date: project?.start_date || '', end_date: project?.end_date || '',
    patent_method: project?.patent_method || '', status: project?.status || 'active', memo: project?.memo || '',
  });
  const [subs, setSubs] = useState<Sub[]>(project?.project_subcontracts?.length ? project.project_subcontracts : [{ name: '', amount: 0, is_patent: false }]);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) return toast('공사명을 넣어 주세요');
    setBusy(true);
    try {
      const row = { ...f, start_date: f.start_date || null, end_date: f.end_date || null, prime_amount: num(String(f.prime_amount)) };
      let id = project?.id;
      if (id) await q(sb.from('projects').update(row).eq('id', id));
      else id = (await q<any>(sb.from('projects').insert({ ...row, created_by: profile!.id }).select('id').single())).id;
      await q(sb.from('project_subcontracts').delete().eq('project_id', id!));
      const clean = subs.filter((s) => s.name.trim()).map((s, i) => ({ project_id: id, name: s.name.trim(), amount: num(String(s.amount)), is_patent: s.is_patent, sort: i }));
      if (clean.length) await q(sb.from('project_subcontracts').insert(clean));
      if (!project) await sb.from('project_members').insert({ project_id: id, user_id: profile!.id, can_boq: true, can_labor: true });
      toast('저장했습니다'); onSaved(id!);
    } catch (e: any) { toast('저장 실패: ' + e.message); }
    setBusy(false);
  };

  return (
    <Modal title={project ? '프로젝트 수정' : '프로젝트 등록'} onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={busy} onClick={save}>저장</button></>}>
      <div className="form-grid">
        <div className="field"><label htmlFor="pf-co">회사</label>
          <select id="pf-co" className="input" value={f.company_id} onChange={(e) => set('company_id', e.target.value)} disabled={!isSys && !!project}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="pf-st">상태</label>
          <select id="pf-st" className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field full"><label htmlFor="pf-name">공사명</label><input id="pf-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label htmlFor="pf-cl">발주처</label><input id="pf-cl" className="input" value={f.client} onChange={(e) => set('client', e.target.value)} /></div>
        <div className="field"><label htmlFor="pf-pm">특허반영공법</label><input id="pf-pm" className="input" value={f.patent_method} onChange={(e) => set('patent_method', e.target.value)} /></div>
        <div className="field"><label htmlFor="pf-pc">도급사</label><input id="pf-pc" className="input" value={f.prime_contractor} onChange={(e) => set('prime_contractor', e.target.value)} /></div>
        <div className="field"><label htmlFor="pf-pa">도급금액 (원)</label><input id="pf-pa" className="input num" inputMode="numeric" value={Number(f.prime_amount).toLocaleString('ko-KR')} onChange={(e) => set('prime_amount', num(e.target.value))} /></div>
        <div className="field"><label htmlFor="pf-sd">착공일</label><input id="pf-sd" type="date" className="input" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
        <div className="field"><label htmlFor="pf-ed">준공일</label><input id="pf-ed" type="date" className="input" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></div>
      </div>
      <div className="card" style={{ padding: 14, background: 'var(--bg)' }}>
        <div className="card-h"><h3>하도급사 (특허사) · 하도급액</h3><button className="btn sm" onClick={() => setSubs([...subs, { name: '', amount: 0, is_patent: false }])}>+ 추가</button></div>
        {subs.map((s, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
            <input aria-label="하도급사" className="input" placeholder="회사명" value={s.name} onChange={(e) => setSubs(subs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input aria-label="하도급액" className="input num" style={{ maxWidth: 180, textAlign: 'right' }} inputMode="numeric" value={Number(s.amount).toLocaleString('ko-KR')} onChange={(e) => setSubs(subs.map((x, j) => (j === i ? { ...x, amount: num(e.target.value) } : x)))} />
            <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={s.is_patent} onChange={(e) => setSubs(subs.map((x, j) => (j === i ? { ...x, is_patent: e.target.checked } : x)))} />특허사</label>
            <button className="btn sm" aria-label="삭제" onClick={() => setSubs(subs.filter((_, j) => j !== i))}>✕</button>
          </div>))}
      </div>
      <div className="field"><label htmlFor="pf-memo">메모</label><textarea id="pf-memo" className="input" rows={2} value={f.memo} onChange={(e) => set('memo', e.target.value)} /></div>
    </Modal>
  );
}
