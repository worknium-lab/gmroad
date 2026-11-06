// DB 권한 · 공정률 시험: 수파베이스를 흉내 낸 임시 PostgreSQL에 마이그레이션을 올리고 역할별로 확인합니다.
//   cd tests && npm install && npm test
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'fs';

const db = new EmbeddedPostgres({ databaseDir: '/tmp/gm-pgtest', user: 'postgres', password: 'pw', port: 54329, persistent: false });
await db.initialise();
await db.start();
const c = new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', password: 'pw', database: 'postgres' });
await c.connect();
const q = (s, p) => c.query(s, p);

// --- Supabase 흉내 (auth · storage · 역할) ---
await q(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant usage on schema storage to authenticated, service_role; grant all on storage.objects to authenticated, service_role;
`);
await q(fs.readFileSync(process.argv[2], 'utf8'));
for (const f of process.argv.slice(3)) await q(fs.readFileSync(f, 'utf8'));
console.log('migration OK');

// --- 권한 시험 ---
const ids = { admin: '00000000-0000-0000-0000-000000000001', staff: '00000000-0000-0000-0000-000000000002', field: '00000000-0000-0000-0000-000000000003', other: '00000000-0000-0000-0000-000000000004' };
const co = (await q(`select id, code from gm.companies order by sort`)).rows;
for (const [k, id] of Object.entries(ids)) await q(`insert into auth.users values ($1, $2)`, [id, k + '@gm.local']);
await q(`insert into gm.profiles (id, username, name, role, company_id) values
 ($1,'gmconst','관리자','system_admin',$5),($2,'staff1','본사','staff',$5),($3,'field1','현장','field',$5),($4,'other','타사','staff',$6)`,
 [ids.admin, ids.staff, ids.field, ids.other, co[0].id, co[1].id]);

async function as(user, fn) {
  await q('begin');
  await q(`set local role authenticated`);
  await q(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  try { return await fn(); } finally { await q('rollback'); }
}
async function asCommit(user, fn) {
  await q('begin');
  await q(`set local role authenticated`);
  await q(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  try { const r = await fn(); await q('commit'); return r; } catch (e) { await q('rollback'); throw e; }
}

// 관리자: 프로젝트 생성 + 구성
const pid = await asCommit(ids.admin, async () => {
  const p = (await q(`insert into gm.projects (company_id, name, client, prime_amount) values ($1,'공릉천교','발주처',1284500000) returning id`, [co[0].id])).rows[0].id;
  await q(`insert into gm.project_members (project_id, user_id) values ($1,$2),($1,$3)`, [p, ids.staff, ids.field]);
  const f = (await q(`insert into gm.facilities (project_id, name) values ($1,'교량 1') returning id`, [p])).rows[0].id;
  const l = (await q(`insert into gm.locations (facility_id, name) values ($1,'P2') returning id`, [f])).rows[0].id;
  const w = (await q(`insert into gm.work_items (project_id, name, unit, unit_price) values ($1,'받침 교체','개',1850000) returning id`, [p])).rows[0].id;
  await q(`insert into gm.location_work values ($1,$2,4)`, [l, w]);
  return p;
});
const { l, w } = (await q(`select lw.location_id l, lw.work_item_id w from gm.location_work lw`)).rows[0];

const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) process.exitCode = 1; };

check('본사 직원은 배정 프로젝트를 봄', (await as(ids.staff, () => q(`select * from gm.projects`))).rowCount === 1);
check('타사 직원은 못 봄', (await as(ids.other, () => q(`select * from gm.projects`))).rowCount === 0);
check('현장 담당자는 봄', (await as(ids.field, () => q(`select * from gm.projects`))).rowCount === 1);

let err = null;
try { await as(ids.field, () => q(`update gm.projects set name='x' where id=$1 returning id`, [pid]).then(r => { if (r.rowCount === 0) throw new Error('0 rows'); })); } catch (e) { err = e; }
check('현장 담당자는 프로젝트 수정 불가', !!err);

// 현장: 일보 + 수량 입력 + 제출
const rid = await asCommit(ids.field, async () => {
  const r = (await q(`insert into gm.daily_reports (project_id, report_date) values ($1, current_date) returning id`, [pid])).rows[0].id;
  await q(`insert into gm.daily_crews (report_id, trade, headcount) values ($1,'보통인부',6)`, [r]);
  await q(`insert into gm.progress_entries (report_id, project_id, location_id, work_item_id, qty, status) values ($1,$2,$3,$4,1,'approved')`, [r, pid, l, w]);
  await q(`update gm.daily_reports set status='submitted' where id=$1`, [r]);
  return r;
});
check('현장 입력은 항상 승인 대기로 들어감', (await q(`select status from gm.progress_entries`)).rows[0].status === 'pending');
check('일보 제출 시 본사 직원에게 알림', (await q(`select count(*)::int n from gm.notifications where user_id=$1`, [ids.staff])).rows[0].n === 1);

err = null;
try { await as(ids.field, () => q(`update gm.progress_entries set status='approved'`)); } catch (e) { err = e; }
check('현장 담당자는 승인 불가', !!err);

await asCommit(ids.staff, () => q(`update gm.progress_entries set status='approved'`));
const s = (await as(ids.staff, () => q(`select * from gm.v_project_summary`))).rows[0];
check('공정률 25% (1/4개)', Number(s.progress_pct) === 25 && Number(s.done_amount) === 1850000);
check('타사 직원은 공정률도 못 봄', (await as(ids.other, () => q(`select * from gm.v_project_summary`))).rowCount === 0);

// 자료요청 → 알림
await asCommit(ids.staff, () => q(`insert into gm.requests (project_id, title, from_user, to_user) values ($1,'P2 사진',$2,$3)`, [pid, ids.staff, ids.field]));
check('자료요청 시 현장에 알림', (await q(`select count(*)::int n from gm.notifications where user_id=$1`, [ids.field])).rows[0].n === 1);
await asCommit(ids.field, () => q(`update gm.requests set status='done', answer_note='올림'`));
check('요청 완료 시 요청자에게 알림', (await q(`select count(*)::int n from gm.notifications where user_id=$1`, [ids.staff])).rows[0].n === 2);

// 프로필 보호
await asCommit(ids.field, () => q(`update gm.profiles set role='system_admin', phone='010' where id=$1`, [ids.field]));
const pf = (await q(`select role, phone from gm.profiles where id=$1`, [ids.field])).rows[0];
check('본인은 역할을 못 바꾸고 연락처는 바꿈', pf.role === 'field' && pf.phone === '010');

// 저장소 권한
check('현장은 파일 업로드 가능', (await as(ids.field, () => q(`insert into storage.objects (bucket_id, name) values ('project-files', $1) returning id`, [pid + '/photos/a.jpg']))).rowCount === 1);
err = null;
try { await as(ids.other, () => q(`insert into storage.objects (bucket_id, name) values ('project-files', $1)`, [pid + '/photos/a.jpg'])); } catch (e) { err = e; }
check('타사는 업로드 불가', !!err);

// 자재
await asCommit(ids.staff, async () => {
  const m = (await q(`insert into gm.materials (project_id, name, unit) values ($1,'무수축 모르타르','포') returning id`, [pid])).rows[0].id;
  await q(`insert into gm.material_moves (project_id, material_id, kind, qty) values ($1,$2,'in',40),($1,$2,'use',32)`, [pid, m]);
});
check('자재 재고 8', Number((await as(ids.staff, () => q(`select stock_qty from gm.v_material_ledger`))).rows[0].stock_qty) === 8);

// 내역서 (002): 금액 권한(can_boq) 있는 사람만 봄, 쓰기는 API(service_role)만
await q(`insert into gm.boq_revisions (project_id, kind, title, storage_path, file_name, sheet_name, header_row, col_map) values ($1,'design','설계내역서','x','x.xlsx','내역서',2,'{}')`, [pid]);
check('관리자는 내역서를 봄', (await as(ids.admin, () => q(`select * from gm.boq_revisions`))).rowCount === 1);
check('내역서 권한 없는 직원은 못 봄', (await as(ids.staff, () => q(`select * from gm.boq_revisions`))).rowCount === 0);
await q(`update gm.project_members set can_boq = true where project_id=$1 and user_id=$2`, [pid, ids.staff]);
check('내역서 권한 준 직원은 봄', (await as(ids.staff, () => q(`select * from gm.boq_revisions`))).rowCount === 1);
err = null;
try { await as(ids.staff, () => q(`insert into gm.boq_revisions (project_id, kind, title, storage_path, file_name, sheet_name, header_row) values ($1,'design','y','y','y','y',1)`, [pid])); } catch (e) { err = e; }
check('직원이 직접 내역서를 쓰지 못함', !!err);

// 003: 잠금 비밀번호는 화면에서 못 읽고, 이력은 내역서 권한자만 봄
await q(`insert into gm.boq_secrets (company_id, unlock_hash) values ($1, 'scrypt$x$y')`, [co[0].id]);
err = null;
try { await as(ids.admin, () => q(`select * from gm.boq_secrets`)); } catch (e) { err = e; }
check('잠금 비밀번호는 관리자도 화면에서 못 읽음', !!err);
await q(`insert into gm.boq_logs (project_id, action) values ($1, '확정')`, [pid]);
check('내역서 권한자는 이력을 봄', (await as(ids.staff, () => q(`select * from gm.boq_logs`))).rowCount === 1);
check('타사 직원은 이력을 못 봄', (await as(ids.other, () => q(`select * from gm.boq_logs`))).rowCount === 0);

// 004: 일위대가는 작성 중 변경내역서에만, 내역서 권한 있는 직원이 씀
const chg = (await q(`insert into gm.boq_revisions (project_id, kind, title, storage_path, file_name, sheet_name, header_row, col_map) values ($1,'change','1차 변경','x','x.xlsx','변경',2,'{}') returning id`, [pid])).rows[0].id;
check('권한 직원은 작성 중 변경내역서에 일위대가를 씀', (await as(ids.staff, () => q(`insert into gm.boq_unit_costs (project_id, revision_id, name) values ($1,$2,'받침 보강') returning id`, [pid, chg]))).rowCount === 1);
err = null;
try { await as(ids.field, () => q(`insert into gm.boq_unit_costs (project_id, revision_id, name) values ($1,$2,'x')`, [pid, chg])); } catch (e) { err = e; }
check('현장 담당자는 일위대가를 못 씀', !!err);
await q(`update gm.boq_revisions set locked = true, status = 'confirmed' where id = $1`, [chg]);
err = null;
try { await as(ids.staff, () => q(`insert into gm.boq_quotes (project_id, revision_id, name) values ($1,$2,'앵커')`, [pid, chg])); } catch (e) { err = e; }
check('확정된 변경내역서에는 단가산출서를 못 씀', !!err);

// 005: 회의록 — 현장 담당자도 쓰고, 확정(잠금)되면 못 고침, 타사는 못 봄
const mid = await asCommit(ids.field, async () => (await q(`insert into gm.meetings (project_id, title, consent) values ($1, '현장 회의', true) returning id`, [pid])).rows[0].id);
check('현장 담당자가 회의록을 만듦', !!mid);
check('타사 직원은 회의록을 못 봄', (await as(ids.other, () => q(`select * from gm.meetings`))).rowCount === 0);
check('본사 직원은 회의록을 봄', (await as(ids.staff, () => q(`select * from gm.meetings`))).rowCount === 1);
const tid = await asCommit(ids.staff, async () => (await q(`insert into gm.meeting_todos (meeting_id, project_id, text, assignee_id, due_date) values ($1,$2,'받침 사진 올리기',$3,'2026-11-13') returning id`, [mid, pid, ids.field])).rows[0].id);
check('할 일 담당자에게 알림', (await q(`select count(*)::int n from gm.notifications where user_id=$1 and title like '회의 할 일%'`, [ids.field])).rows[0].n === 1);
await q(`update gm.meetings set locked = true where id = $1`, [mid]);
check('확정된 회의록은 못 고침', (await as(ids.field, () => q(`update gm.meetings set title='x' where id=$1 returning id`, [mid]))).rowCount === 0);
check('확정 후에도 담당자는 할 일 완료 체크', (await as(ids.field, () => q(`update gm.meeting_todos set done = true where id=$1 returning done_at`, [tid]))).rows[0]?.done_at != null);
err = null;
try { await as(ids.staff, () => q(`update gm.meeting_todos set text='바꿈' where id=$1`, [tid])); } catch (e) { err = e; }
check('확정 후 할 일 내용은 못 바꿈', !!err);
err = null;
try { await as(ids.field, () => q(`insert into gm.project_alerts (project_id, kind, text) values ($1,'notice','x')`, [pid])); } catch (e) { err = e; }
check('현장 담당자는 알림칸에 못 올림', !!err);
const al = (await q(`insert into gm.project_alerts (project_id, kind, text) values ($1,'decision','받침 교체 11/13까지') returning id`, [pid])).rows[0].id;
check('현장 담당자도 알림을 확인', (await as(ids.field, () => q(`insert into gm.alert_acks (alert_id, user_id) values ($1,$2) returning alert_id`, [al, ids.field]))).rowCount === 1);

// 006: 노무비 — 노무비 권한(can_labor)이 있는 사람만, 확정되면 못 고침
await q(`insert into gm.labor_workers (project_id, name, birth, acct) values ($1,'김정호','1968-04-12','123-45')`, [pid]);
check('노무비 권한 없는 직원은 근로자 계좌를 못 봄', (await as(ids.staff, () => q(`select * from gm.labor_workers`))).rowCount === 0);
check('현장 담당자도 근로자 계좌를 못 봄', (await as(ids.field, () => q(`select * from gm.labor_workers`))).rowCount === 0);
await q(`update gm.project_members set can_labor = true where project_id=$1 and user_id=$2`, [pid, ids.staff]);
check('노무비 권한 준 직원은 봄', (await as(ids.staff, () => q(`select * from gm.labor_workers`))).rowCount === 1);
const lm = await asCommit(ids.staff, async () => (await q(`insert into gm.labor_months (project_id, ym) values ($1,'2026-10') returning id`, [pid])).rows[0].id);
await asCommit(ids.staff, () => q(`update gm.labor_months set locked = true where id=$1`, [lm]));
check('확정된 노무비는 화면에서 못 고침', (await as(ids.staff, () => q(`update gm.labor_months set locked=false where id=$1 returning id`, [lm]))).rowCount === 0);

// 007: 공용공간 · 인사정보 보호
await q(`update gm.profiles set phone='010-1111-2222', address='서울시', phone_public=false where id=$1`, [ids.staff]);
err = null;
try { await as(ids.field, () => q(`select address from gm.profiles where id=$1`, [ids.staff])); } catch (e) { err = e; }
check('다른 사람 주소는 못 읽음', !!err);
check('이름 · 부서는 읽음', (await as(ids.field, () => q(`select name, dept from gm.profiles`))).rowCount >= 3);
check('내 정보는 전부 읽음', (await as(ids.staff, () => q(`select * from gm.my_profile()`))).rows[0]?.address === '서울시');
check('관리자는 직원 정보 전부', (await as(ids.admin, () => q(`select * from gm.admin_profiles()`))).rowCount === 4);
check('일반 직원은 관리자 목록 못 봄', (await as(ids.staff, () => q(`select * from gm.admin_profiles()`))).rowCount === 0);
check('연락처: 비공개 휴대폰은 숨김', (await as(ids.field, () => q(`select phone from gm.v_directory where id=$1`, [ids.staff]))).rows[0].phone === null);
await q(`update gm.profiles set phone_public=true where id=$1`, [ids.staff]);
check('연락처: 공개한 휴대폰은 보임', (await as(ids.field, () => q(`select phone from gm.v_directory where id=$1`, [ids.staff]))).rows[0].phone === '010-1111-2222');
const post = await asCommit(ids.staff, async () => (await q(`insert into gm.posts (title, must_read, target_companies, event_date, author_id) values ('안전교육', true, array[$1::uuid], '2026-11-20', $2) returning id`, [co[0].id, ids.staff])).rows[0].id);
check('대상 회사 직원은 공지를 봄', (await as(ids.field, () => q(`select * from gm.posts`))).rowCount === 1);
check('다른 회사 직원은 못 봄', (await as(ids.other, () => q(`select * from gm.posts`))).rowCount === 0);
check('공지 날짜가 회사 일정에 올라감', (await as(ids.field, () => q(`select * from gm.events where post_id=$1`, [post]))).rows[0]?.category === '회사');
check('다른 회사는 그 일정도 못 봄', (await as(ids.other, () => q(`select * from gm.events`))).rowCount === 0);
err = null;
try { await as(ids.field, () => q(`insert into gm.posts (title, author_id) values ('x', $1)`, [ids.field])); } catch (e) { err = e; }
check('현장 담당자는 공지를 못 씀', !!err);
await asCommit(ids.field, () => q(`insert into gm.post_reads (post_id, user_id, confirmed_at) values ($1,$2,now())`, [post, ids.field]));
check('작성자는 확인 현황을 봄', (await as(ids.staff, () => q(`select * from gm.post_reads where post_id=$1`, [post]))).rowCount === 1);
check('다른 사람은 남의 확인 기록을 못 봄', (await as(ids.admin, () => q(`select 1`))) && (await as(ids.other, () => q(`select * from gm.post_reads`))).rowCount === 0);
const fut = await asCommit(ids.staff, async () => (await q(`insert into gm.posts (title, publish_at, author_id) values ('예약', now() + interval '1 day', $1) returning id`, [ids.staff])).rows[0].id);
check('예약 글은 게시 전에는 안 보임', (await as(ids.field, () => q(`select * from gm.posts where id=$1`, [fut]))).rowCount === 0);
await asCommit(ids.staff, () => q(`insert into gm.library_files (folder, title, path, file_name) values ('카탈로그','특허공법 카탈로그','library/x/a.pdf','a.pdf')`));
const v2 = await asCommit(ids.staff, async () => (await q(`insert into gm.library_files (folder, title, path, file_name) values ('카탈로그','특허공법 카탈로그','library/x/b.pdf','b.pdf') returning version`)).rows[0].version);
check('같은 이름은 새 버전', v2 === 2 && (await q(`select count(*)::int n from gm.library_files where is_latest`)).rows[0].n === 1);
err = null;
try { await as(ids.staff, () => q(`insert into gm.share_links (file_id, token, expires_at) select id, 'abc', now() + interval '7 day' from gm.library_files limit 1`)); } catch (e) { err = e; }
check('사내 전용 자료는 외부 공유 링크를 못 만듦', !!err);

// 008: 사진 전용 앱
await q(`update gm.project_members set can_field = true where project_id=$1 and user_id=$2`, [pid, ids.field]);
const ph = await asCommit(ids.field, async () => (await q(`insert into gm.photos (project_id, storage_path, taken_at, uploaded_by, kind) values ($1, $2, '2026-11-05T23:30:00+09:00', $3, '시공 전'), ($1, $2 || 'b', '2026-11-06T00:30:00+09:00', $3, '시공 후') returning id, taken_day::text`, [pid, pid + '/photos/x.jpg', ids.field])).rows);
check('촬영일은 한국 시간 기준', ph[0].taken_day === '2026-11-05' && ph[1].taken_day === '2026-11-06');
const days = (await as(ids.staff, () => q(`select * from gm.photo_days($1)`, [pid]))).rows;
check('날짜별 묶음 2일', days.length === 2 && days[0].n === 1);
check('타사 직원은 날짜 목록도 비어 있음', (await as(ids.other, () => q(`select * from gm.photo_days($1)`, [pid]))).rowCount === 0);
const pp = (await as(ids.field, () => q(`select * from gm.photo_projects()`))).rows;
check('프로젝트별 사진 수', pp.length === 1 && pp[0].n === 2 && pp[0].cover);
err = null;
try { await as(ids.field, () => q(`insert into gm.photos (project_id, storage_path, uploaded_by) values ($1,'x',$2)`, [pid, ids.staff])); } catch (e) { err = e; }
check('남의 이름으로는 못 올림', !!err);
const ph2 = await asCommit(ids.admin, async () => (await q(`insert into gm.photos (project_id, storage_path, uploaded_by) values ($1,'y',$2) returning id`, [pid, ids.admin])).rows[0].id);
check('현장은 남이 올린 사진을 못 지움', (await as(ids.field, () => q(`delete from gm.photos where id=$1 returning id`, [ph2]))).rowCount === 0);
check('현장은 자기 사진 정보를 고침', (await as(ids.field, () => q(`update gm.photos set caption='P2 받침' where id=$1 returning id`, [ph[0].id]))).rowCount === 1);
check('본사는 모든 사진을 지움', (await as(ids.staff, () => q(`delete from gm.photos where id=$1 returning id`, [ph[0].id]))).rowCount === 1);
const sh = await asCommit(ids.field, async () => (await q(`insert into gm.photo_sheets (project_id, title, per_page, items) values ($1,'받침 교체 사진대지',3,$2) returning id`, [pid, JSON.stringify([{ photo_id: ph[1].id, caption: 'P2' }])])).rows[0].id);
check('사진대지는 본사도 봄', (await as(ids.staff, () => q(`select * from gm.photo_sheets where id=$1`, [sh]))).rowCount === 1);
check('타사는 사진대지 못 봄', (await as(ids.other, () => q(`select * from gm.photo_sheets`))).rowCount === 0);
err = null;
try { await as(ids.field, () => q(`update gm.photo_sheets set per_page=5 where id=$1`, [sh])); } catch (e) { err = e; }
check('한 쪽 사진 수는 2·3·4·6만', !!err);

// 009: 제품 · 실적
const prod = await asCommit(ids.staff, async () => (await q(`insert into gm.products (company_id, kind, name, spec, unit, price, contract_end) values ($1,'관급','탄성받침','400×400','EA',1850000, current_date + 30) returning id`, [co[0].id])).rows[0].id);
check('본사 직원은 자기 회사 제품 등록', !!prod);
err = null;
try { await as(ids.staff, () => q(`insert into gm.products (company_id, name) values ($1,'남의 회사 제품')`, [co[1].id])); } catch (e) { err = e; }
check('다른 회사 제품은 못 등록', !!err);
check('현장 담당자는 제품을 못 봄', (await as(ids.field, () => q(`select * from gm.products`))).rowCount === 0);
check('타사 직원도 조회는 함 (회사 선택으로 거름)', (await as(ids.other, () => q(`select * from gm.products`))).rowCount === 1);
check('타사 직원은 고치지 못함', (await as(ids.other, () => q(`update gm.products set price=1 where id=$1 returning id`, [prod]))).rowCount === 0);
const dv = await asCommit(ids.staff, async () => (await q(`insert into gm.deliveries (product_id, company_id, kind, project_id, qty, price, delivered_on) values ($1, $2, '사급', $3, 3.7, 1850001, '2026-10-15') returning *`, [prod, co[1].id, pid])).rows[0]);
check('납품 금액 = TRUNC(수량×단가)', Number(dv.amount) === Math.trunc(3.7 * 1850001));
check('회사 · 관급/사급은 제품에서 자동', dv.company_id === co[0].id && dv.kind === '관급');
check('프로젝트 연결하면 공사명 · 발주처 자동', dv.project_name === '공릉천교' && dv.client === '발주처');
const stv = (await as(ids.admin, () => q(`select * from gm.v_product_stats where product_id=$1`, [prod]))).rows[0];
check('제품별 납품 누계', stv.n === 1 && Number(stv.amount) === Number(dv.amount));
err = null;
try { await as(ids.staff, () => q(`delete from gm.products where id=$1`, [prod])); } catch (e) { err = e; }
check('납품이력이 있는 제품은 못 지움 (중단 처리)', !!err);
check('사진 폴더: 자기 회사 제품만 올림', (await as(ids.staff, () => q(`insert into storage.objects (bucket_id, name) values ('space-files', $1) returning id`, ['product/' + prod + '/a.jpg']))).rowCount === 1);
err = null;
try { await as(ids.other, () => q(`insert into storage.objects (bucket_id, name) values ('space-files', $1)`, ['product/' + prod + '/a.jpg'])); } catch (e) { err = e; }
check('다른 회사 제품 사진은 못 올림', !!err);

// 010: 앱 푸시
await asCommit(ids.field, () => q(`select gm.push_register('https://push.example/abc', 'k1', 'a1', 'Android Chrome')`));
check('내 기기 등록', (await as(ids.field, () => q(`select * from gm.push_subscriptions`))).rowCount === 1);
check('남의 기기는 안 보임', (await as(ids.staff, () => q(`select * from gm.push_subscriptions`))).rowCount === 0);
await asCommit(ids.staff, () => q(`select gm.push_register('https://push.example/abc', 'k2', 'a2', 'Android Chrome')`));
check('같은 폰에 다른 사람이 로그인하면 넘겨받음', (await q(`select user_id from gm.push_subscriptions`)).rows.every((r) => r.user_id === ids.staff) && (await q(`select count(*)::int n from gm.push_subscriptions`)).rows[0].n === 1);
err = null;
try { await as(ids.admin, () => q(`select * from gm.push_keys`)); } catch (e) { err = e; }
check('푸시 키는 화면에서 못 읽음', !!err);
err = null;
try { await as(ids.field, () => q(`insert into gm.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1,'x','y','z')`, [ids.staff])); } catch (e) { err = e; }
check('남의 이름으로 기기 등록 못 함', !!err);

// 011: 라이선스 잠금
const mode = async () => (await as(ids.staff, () => q(`select gm.license_mode() m`))).rows[0].m;
const setPaid = (sql) => q(`update gm.license_state set ${sql}`);
check('처음 설치는 정상 (설정 기간 60일)', await mode() === 'normal');
err = null;
try { await as(ids.admin, () => q(`update gm.license_state set paid_until = '2099-12-31'`)); } catch (e) { err = e; }
check('관리자 계정도 라이선스 값을 못 고침', !!err);
err = null;
try { await as(ids.admin, () => q(`select * from gm.license_state`)); } catch (e) { err = e; }
check('라이선스 원본은 화면에서 못 읽음', !!err);
check('요약 정보는 누구나 봄', (await as(ids.field, () => q(`select gm.license_info() i`))).rows[0].i.mode === 'normal');
const kst = (d) => new Date(Date.now() + 9 * 3600e3 + d * 864e5).toISOString().slice(0, 10);
await setPaid(`paid_until = '${kst(-3)}'`);
check('만료 3일 뒤 = 유예', await mode() === 'grace');
check('유예 때는 입력 가능', (await as(ids.staff, () => q(`update gm.projects set memo = 'x' where id=$1 returning id`, [pid]))).rowCount === 1);
await setPaid(`paid_until = '${kst(-10)}'`);
check('만료 10일 뒤 = 읽기 전용', await mode() === 'readonly');
err = null;
try { await as(ids.staff, () => q(`update gm.projects set memo = 'x' where id=$1`, [pid])); } catch (e) { err = e; }
check('읽기 전용: 입력 막힘', !!err && /읽기 전용/.test(err.message));
check('읽기 전용: 관리 API(서비스 키)는 내려받기 파일 저장 가능', (await (async () => { await q('begin'); await q('set local role service_role'); try { return await q(`insert into storage.objects (bucket_id, name) values ('project-files', $1) returning id`, [pid + '/sheets/x.xlsx']); } finally { await q('rollback'); } })()).rowCount === 1);
check('읽기 전용: 보기는 됨', (await as(ids.staff, () => q(`select * from gm.projects`))).rowCount === 1);
err = null;
try { await as(ids.field, () => q(`insert into storage.objects (bucket_id, name) values ('project-files', $1)`, [pid + '/photos/z.jpg'])); } catch (e) { err = e; }
check('읽기 전용: 파일 올리기 막힘', !!err);
check('읽기 전용: 알림 읽음 표시는 됨', (await as(ids.field, () => q(`update gm.notifications set read_at = now() where user_id=$1 returning id`, [ids.field]))).rowCount >= 0);
err = null;
try { await q(`create table gm.zz_new (id int)`); await as(ids.staff, () => q(`insert into gm.zz_new values (1)`)); } catch (e) { err = e; }
check('나중에 만든 테이블도 자동으로 잠김', !!err);
await q(`drop table gm.zz_new`);
await setPaid(`readonly_extra = 5, paid_until = '${kst(-40)}'`);
check('백업 연장 5일이면 40일째도 읽기 전용', await mode() === 'readonly');
await setPaid(`readonly_extra = 0`);
check('39일 지나면 차단', await mode() === 'blocked');
await setPaid(`paid_until = '${kst(20)}', max_seen_at = now() + interval '30 days'`);
check('시계를 되돌려도 늦은 시각 기준 (만료 10일 지난 것으로 계산)', await mode() === 'readonly');
await setPaid(`paid_until = '${kst(60)}', max_seen_at = now(), tampered = true`);
check('위변조 감지 → 읽기 전용', await mode() === 'readonly');
await setPaid(`tampered = false`);
await q(`delete from gm.license_state`);
check('라이선스 행을 지우면 차단', await mode() === 'blocked');
await q(`insert into gm.license_state (id) values (1)`);
check('다시 정상', await mode() === 'normal');

await c.end();
await db.stop();
