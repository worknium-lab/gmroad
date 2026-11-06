import { useAuth } from '../../lib/auth';
import { sb, q } from '../../lib/supabase';
import { useToast } from '../../lib/ui';

export default function Companies() {
  const { companies, isSys, reload } = useAuth();
  const toast = useToast();
  const save = async (id: string, e: any) => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await q(sb.from('companies').update({ name: f.get('name'), biz_no: f.get('biz_no') || null, ceo: f.get('ceo') || null, address: f.get('address') || null }).eq('id', id)); toast('저장했습니다'); reload(); } catch (er: any) { toast(er.message); }
  };
  return (
    <>
      <h1>회사 관리</h1>
      {!isSys && <div className="banner">회사 정보 수정은 시스템 관리자만 할 수 있습니다.</div>}
      <div className="grid g3">{companies.map((c) => (
        <form key={c.id} className="card" onSubmit={(e) => save(c.id, e)}>
          <h2>{c.name}</h2>
          {[['name', '회사명', c.name], ['biz_no', '사업자번호', c.biz_no], ['ceo', '대표자', c.ceo], ['address', '주소', c.address]].map(([k, l, v]) => (
            <div key={k} className="field"><label htmlFor={c.id + k}>{l}</label><input id={c.id + k} name={k as string} className="input" defaultValue={(v as string) || ''} disabled={!isSys} /></div>))}
          {isSys && <button className="btn pri">저장</button>}
        </form>))}
      </div>
      <span className="muted">재직증명서의 회사명 · 대표자 · 주소로 쓰입니다. 고객사(납품용) 추가는 5단계에서 만듭니다.</span>
    </>
  );
}
