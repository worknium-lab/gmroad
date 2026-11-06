import { useState } from 'react';
import { sb, q, api } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { ROLE } from '../../lib/format';
import { useLoad, Loading, Modal, Pill, useToast } from '../../lib/ui';

const FIELDS: [string, string][] = [['name', '이름'], ['emp_no', '사번'], ['dept', '부서'], ['rank', '직급'], ['position', '직책'], ['phone', '휴대폰'], ['email', '이메일'], ['hire_date', '입사일'], ['address', '주소']];
const ROLE_C: Record<string, string> = { system_admin: 'navy', company_admin: 'blue', staff: '', field: 'teal', viewer: 'orange' };

export default function Users() {
  const { companies, isSys, profile } = useAuth();
  const toast = useToast();
  const [edit, setEdit] = useState<any | null>(null);
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const { data, loading, reload } = useLoad(() => q<any[]>(sb.rpc('admin_profiles')), []);
  if (loading) return <Loading />;
  const coName = (id: string) => companies.find((c) => c.id === id)?.name || '-';
  const roles = Object.entries(ROLE).filter(([k]) => isSys || k !== 'system_admin');

  const save = async () => {
    try {
      const body: any = Object.fromEntries(FIELDS.map(([k]) => [k, edit[k] || null]));
      body.role = edit.role; body.company_id = edit.company_id || null; body.active = edit.active !== false;
      if (edit.id) { await q(sb.from('profiles').update(body).eq('id', edit.id)); toast('저장했습니다'); }
      else {
        if (!/^[a-z0-9._-]{3,}$/i.test(edit.username || '')) return toast('아이디는 영문 · 숫자 3자 이상');
        const r = await api('/admin/users', { username: edit.username, ...body });
        setTemp({ username: edit.username, password: r.temp_password });
      }
      setEdit(null); reload();
    } catch (e: any) { toast(e.message); }
  };
  const reset = async (u: any) => {
    if (!confirm(`${u.username}의 비밀번호를 초기화할까요?`)) return;
    try { const r = await api('/admin/users/reset', { id: u.id }); setTemp({ username: u.username, password: r.temp_password }); } catch (e: any) { toast(e.message); }
  };

  return (
    <>
      <div className="row between"><div className="row"><h1>사용자 · 권한</h1><Pill c="orange">관리자 계정 전용</Pill></div><button className="btn pri" onClick={() => setEdit({ role: 'staff', company_id: profile?.company_id, active: true })}>+ 계정 만들기</button></div>
      <section className="card flat"><div className="tbl-wrap"><table className="tbl" style={{ minWidth: 820 }}>
        <thead><tr><th>아이디</th><th>이름</th><th>회사 · 부서</th><th>직급 · 직책</th><th>역할</th><th>상태</th><th /></tr></thead>
        <tbody>{data?.map((u) => <tr key={u.id}><td><b>{u.username}</b></td><td>{u.name}</td><td>{coName(u.company_id)}{u.dept ? ' · ' + u.dept : ''}</td><td>{[u.rank, u.position].filter(Boolean).join(' · ') || '-'}</td>
          <td><Pill c={ROLE_C[u.role]}>{ROLE[u.role]}</Pill></td><td>{u.active ? (u.must_change_password ? <Pill c="orange">첫 로그인 전</Pill> : <Pill c="green">사용 중</Pill>) : <Pill>중지</Pill>}</td>
          <td className="row" style={{ flexWrap: 'nowrap' }}><button className="btn sm" onClick={() => setEdit({ ...u })}>수정</button><button className="btn sm" onClick={() => reset(u)}>비밀번호 초기화</button></td></tr>)}</tbody>
      </table></div></section>
      <section className="card"><h2>역할별 권한</h2>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>역할</th><th>볼 수 있는 것</th><th>할 수 있는 것</th></tr></thead><tbody>
          <tr><td><Pill c="navy">시스템 관리자</Pill></td><td>전체 회사 · 전체 프로젝트</td><td>모든 작업 · 계정 · 회사 관리</td></tr>
          <tr><td><Pill c="blue">회사 관리자</Pill></td><td>자기 회사 전체</td><td>자기 회사 프로젝트 · 계정 관리</td></tr>
          <tr><td><Pill>본사 직원</Pill></td><td>배정된 프로젝트</td><td>프로젝트 등록 · 문서 · 구성 · 수량 승인 · 자료요청</td></tr>
          <tr><td><Pill c="teal">현장 담당자</Pill></td><td>배정된 현장만</td><td>현장 앱 입력 (일보 · 수량 · 사진 · 자재) · 요청 응답</td></tr>
          <tr><td><Pill c="orange">조회 전용</Pill></td><td>배정된 프로젝트</td><td>보기만</td></tr>
        </tbody></table></div>
        <span className="muted">프로젝트 배정은 각 프로젝트의 ① 개요 탭 '참여자 · 권한'에서 합니다.</span>
      </section>
      {edit && <Modal title={edit.id ? `계정 수정 · ${edit.username}` : '계정 만들기'} onClose={() => setEdit(null)} foot={<><button className="btn" onClick={() => setEdit(null)}>취소</button><button className="btn pri" onClick={save}>{edit.id ? '저장' : '만들기'}</button></>}>
        <div className="form-grid">
          {!edit.id && <div className="field"><label htmlFor="u-id">아이디 (로그인용)</label><input id="u-id" className="input" value={edit.username || ''} onChange={(e) => setEdit({ ...edit, username: e.target.value.trim() })} /></div>}
          <div className="field"><label htmlFor="u-co">회사</label><select id="u-co" className="input" value={edit.company_id || ''} onChange={(e) => setEdit({ ...edit, company_id: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="u-role">역할</label><select id="u-role" className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          {FIELDS.map(([k, l]) => <div key={k} className={'field' + (k === 'address' ? ' full' : '')}><label htmlFor={'u-' + k}>{l}</label><input id={'u-' + k} type={k === 'hire_date' ? 'date' : 'text'} className="input" value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></div>)}
          {edit.id && <label className="check full"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />사용 중 (끄면 로그인해도 아무것도 볼 수 없음)</label>}
        </div>
      </Modal>}
      {temp && <Modal title="임시 비밀번호" onClose={() => setTemp(null)} foot={<button className="btn pri" onClick={() => setTemp(null)}>확인</button>}>
        <p style={{ margin: 0 }}>아래 정보를 사용자에게 전달하세요. 첫 로그인 때 비밀번호를 새로 정하게 됩니다.</p>
        <div className="banner blue" style={{ fontSize: 16 }}>아이디 <b>{temp.username}</b> · 임시 비밀번호 <b style={{ fontFamily: 'monospace' }}>{temp.password}</b></div>
      </Modal>}
    </>
  );
}
