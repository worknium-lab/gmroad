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
grant usage on schema storage to authenticated; grant all on storage.objects to authenticated;
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

await c.end();
await db.stop();
