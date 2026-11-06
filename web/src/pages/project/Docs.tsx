import { useState } from 'react';
import { sb, q } from '../../lib/supabase';
import { upload, download } from '../../lib/files';
import { useAuth } from '../../lib/auth';
import { won, dt, DOC } from '../../lib/format';
import { useLoad, Loading, FileDrop, useToast, Pill, Modal, Empty } from '../../lib/ui';

const DESIGN = ['design_spec', 'design_boq', 'qty_calc', 'drawing'] as const;
const CON_SUB = ['착공 서류', '기성 서류', '준공 서류', '안전 · 품질', '발주처 공문', '기타'];
const CONTRACT_SUB = ['도급계약서', '하도급계약서', '변경계약서', '기타'];
const kb = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.ceil(n / 1024) + 'KB');

export default function Docs({ pid, mode }: { pid: string; mode: 'design' | 'construction' }) {
  const { canEdit, profile } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [contract, setContract] = useState<File[] | null>(null);
  const [cf, setCf] = useState({ subcategory: '도급계약서', contract_party: '', contract_amount: '', contract_date: '' });
  const [conSub, setConSub] = useState(CON_SUB[0]);
  const { data, loading, reload } = useLoad(() => q<any[]>(sb.from('documents').select('*, profiles(name, username)').eq('project_id', pid).order('created_at', { ascending: false })), [pid]);

  const put = async (files: File[], category: string, extra: any = {}) => {
    if (!files.length) return;
    setBusy(category);
    try {
      for (const f of files) {
        const prev = (data || []).filter((d) => d.category === category && d.title === (extra.title || f.name));
        const { path, size } = await upload(pid, 'docs/' + category, f);
        await q(sb.from('documents').insert({ project_id: pid, category, title: extra.title || f.name, version: prev.length + 1, storage_path: path, file_name: f.name, size_bytes: size, mime: f.type, uploaded_by: profile!.id, ...extra, ...(extra.title ? {} : {}) }));
      }
      toast(`${files.length}개 올렸습니다`); reload();
    } catch (e: any) { toast('올리기 실패: ' + e.message); }
    setBusy('');
  };
  const del = async (d: any) => {
    if (!confirm(`'${d.file_name}' 파일을 지울까요?`)) return;
    await sb.storage.from('project-files').remove([d.storage_path]);
    await q(sb.from('documents').delete().eq('id', d.id)); reload();
  };
  if (loading) return <Loading />;
  const docs = data || [];
  const Row = ({ d }: { d: any }) => (
    <div className="row" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 10, flexWrap: 'nowrap' }}>
      <span className="pill" style={{ width: 48, textAlign: 'center' }}>{(d.file_name.split('.').pop() || '').toUpperCase().slice(0, 4)}</span>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</div>
        <div className="muted">v{d.version} · {kb(d.size_bytes || 0)} · {dt(d.created_at)} · {d.profiles?.name || d.profiles?.username}{d.subcategory ? ' · ' + d.subcategory : ''}{d.contract_amount ? ' · ' + won(d.contract_amount) + '원' : ''}</div></div>
      <button className="btn sm" onClick={() => download(d.storage_path, d.file_name).catch((e) => toast(e.message))}>받기</button>
      {canEdit && <button className="btn sm" aria-label="삭제" onClick={() => del(d)}>✕</button>}
    </div>);

  if (mode === 'construction') {
    const list = docs.filter((d) => d.category === 'construction');
    return (
      <div className="grid" style={{ gridTemplateColumns: 'minmax(200px, 260px) 1fr' }}>
        <nav className="card" aria-label="서류함" style={{ padding: 10, gap: 2 }}>
          {CON_SUB.map((s) => <button key={s} className="btn" style={{ justifyContent: 'space-between', border: 0, background: conSub === s ? 'var(--blue-l)' : 'transparent', fontWeight: conSub === s ? 700 : 500 }} onClick={() => setConSub(s)}>
            <span>{s}</span><span className="muted">{list.filter((d) => d.subcategory === s).length}</span></button>)}
        </nav>
        <section className="card"><h2>{conSub}</h2>
          {canEdit && <FileDrop multiple label={busy ? '올리는 중…' : '파일을 끌어다 놓거나 눌러서 고르세요'} onFiles={(f) => put(f, 'construction', { subcategory: conSub })} />}
          {list.filter((d) => d.subcategory === conSub).map((d) => <Row key={d.id} d={d} />)}
          {!list.some((d) => d.subcategory === conSub) && <span className="sub">아직 서류가 없습니다.</span>}
        </section>
      </div>);
  }

  const contracts = docs.filter((d) => d.category === 'contract');
  return (
    <>
      <section className="card"><div className="card-h"><h2>설계도서 4종</h2><span className="muted">같은 이름으로 다시 올리면 새 버전으로 쌓입니다</span></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          {DESIGN.map((c) => { const list = docs.filter((d) => d.category === c); return (
            <div key={c} style={{ border: '1px solid var(--line-3)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row between"><b style={{ fontSize: 15 }}>{DOC[c]}</b>{list.length ? <Pill c="green">{list.length}개</Pill> : <Pill>없음</Pill>}</div>
              {canEdit && <FileDrop multiple={c === 'drawing'} label={busy === c ? '올리는 중…' : c === 'drawing' ? '도면 파일들 (PDF · DWG · 이미지)' : '파일 올리기'} onFiles={(f) => put(f, c)} />}
              {list.slice(0, c === 'drawing' ? 8 : 3).map((d) => <Row key={d.id} d={d} />)}
              {c === 'design_boq' && <span className="muted">엑셀 수식 · 서식 그대로 가져오기는 내역서 단계에서 연결됩니다.</span>}
            </div>); })}
        </div>
      </section>
      <section className="card"><div className="card-h"><h2>계약서류</h2>{canEdit && <FileDrop label="+ 계약서 올리기" onFiles={(f) => f.length && setContract(f)} />}</div>
        {contracts.length ? contracts.map((d) => <Row key={d.id} d={d} />) : <Empty>도급계약서를 올려 주세요. 계약금액은 내역서에서 도급내역서를 맞추는 기준이 됩니다.</Empty>}
      </section>
      {contract && <Modal title="계약서 정보" onClose={() => setContract(null)} foot={<><button className="btn" onClick={() => setContract(null)}>취소</button>
        <button className="btn pri" onClick={async () => { await put(contract, 'contract', { subcategory: cf.subcategory, contract_party: cf.contract_party || null, contract_amount: cf.contract_amount ? Math.trunc(Number(cf.contract_amount.replace(/\D/g, ''))) : null, contract_date: cf.contract_date || null }); setContract(null); }}>올리기</button></>}>
        <span className="sub">{contract.map((f) => f.name).join(', ')}</span>
        <div className="form-grid">
          <div className="field"><label htmlFor="c1">구분</label><select id="c1" className="input" value={cf.subcategory} onChange={(e) => setCf({ ...cf, subcategory: e.target.value })}>{CONTRACT_SUB.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="c2">계약 상대</label><input id="c2" className="input" value={cf.contract_party} onChange={(e) => setCf({ ...cf, contract_party: e.target.value })} /></div>
          <div className="field"><label htmlFor="c3">계약금액 (원)</label><input id="c3" className="input num" inputMode="numeric" value={cf.contract_amount} onChange={(e) => setCf({ ...cf, contract_amount: e.target.value })} /></div>
          <div className="field"><label htmlFor="c4">계약일</label><input id="c4" type="date" className="input" value={cf.contract_date} onChange={(e) => setCf({ ...cf, contract_date: e.target.value })} /></div>
        </div>
      </Modal>}
    </>
  );
}
