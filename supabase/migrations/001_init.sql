-- =====================================================================
-- GM 통합관리도구 · 1차 스키마
-- 대상: Supabase (셀프호스팅) PostgreSQL 15
-- 계산 규칙: 모든 금액은 정수(bigint), 곱셈은 trunc(a*b)
-- =====================================================================

create schema if not exists gm;
grant usage on schema gm to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 회사 · 사용자
-- ---------------------------------------------------------------------
create table gm.companies (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,              -- gmroad / gmr / oo-eng
  name        text not null,
  biz_no      text,
  ceo         text,
  address     text,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

create type gm.user_role as enum ('system_admin', 'company_admin', 'staff', 'field', 'viewer');

create table gm.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  username              text unique not null,     -- 로그인 아이디 (예: gmconst)
  name                  text not null default '',
  company_id            uuid references gm.companies(id),
  role                  gm.user_role not null default 'staff',
  emp_no                text,                     -- 사번
  dept                  text,
  rank                  text,                     -- 직급
  position              text,                     -- 직책
  phone                 text,
  phone_public          boolean not null default false,
  email                 text,
  address               text,
  hire_date             date,
  must_change_password  boolean not null default true,
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 프로젝트
-- ---------------------------------------------------------------------
create type gm.project_status as enum ('planned', 'active', 'done', 'hold');

create table gm.projects (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references gm.companies(id),
  name              text not null,                -- 공사명
  client            text,                         -- 발주처
  prime_contractor  text,                         -- 도급사
  prime_amount      bigint not null default 0,    -- 도급금액
  start_date        date,
  end_date          date,
  patent_method     text,                         -- 특허반영공법
  status            gm.project_status not null default 'active',
  memo              text,
  created_by        uuid references gm.profiles(id),
  created_at        timestamptz not null default now()
);

create table gm.project_subcontracts (            -- 하도급사(특허사), 2개 이상 가능
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references gm.projects(id) on delete cascade,
  name        text not null,
  amount      bigint not null default 0,
  is_patent   boolean not null default false,
  sort        int not null default 0
);

create table gm.project_members (
  project_id  uuid not null references gm.projects(id) on delete cascade,
  user_id     uuid not null references gm.profiles(id) on delete cascade,
  can_boq     boolean not null default false,     -- 내역서 · 금액
  can_labor   boolean not null default false,     -- 노무비
  can_field   boolean not null default true,      -- 현장 앱 입력
  primary key (project_id, user_id)
);

-- ---------------------------------------------------------------------
-- 공사 구성: 시설물 › 위치 › 공종
-- ---------------------------------------------------------------------
create table gm.facilities (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references gm.projects(id) on delete cascade,
  name        text not null,                      -- 교량 1, 옹벽, 공통
  kind        text,                               -- 교량 / 옹벽 / 공통 ...
  sort        int not null default 0
);

create table gm.locations (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references gm.facilities(id) on delete cascade,
  name         text not null,                     -- A1, P1, 구간 1
  sort         int not null default 0
);

create table gm.work_items (                      -- 공종 (도급내역서 연결 전까지 직접 입력)
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references gm.projects(id) on delete cascade,
  name        text not null,
  spec        text,
  unit        text not null default '식',
  unit_price  bigint not null default 0,          -- 도급단가 (공정률 금액 기준)
  sort        int not null default 0
);

create table gm.location_work (                   -- 위치별 설계수량 (체크한 조합만 존재)
  location_id   uuid not null references gm.locations(id) on delete cascade,
  work_item_id  uuid not null references gm.work_items(id) on delete cascade,
  design_qty    numeric(14,3) not null default 0,
  primary key (location_id, work_item_id)
);

-- ---------------------------------------------------------------------
-- 문서 (설계도서 · 계약서류 · 공사서류)
-- ---------------------------------------------------------------------
create type gm.doc_category as enum (
  'design_spec', 'design_boq', 'qty_calc', 'drawing',   -- 설계도서 4종
  'contract',                                           -- 계약서류
  'construction'                                        -- 공사서류
);

create table gm.documents (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references gm.projects(id) on delete cascade,
  category      gm.doc_category not null,
  subcategory   text,                              -- 계약: 도급/하도급/변경, 공사서류: 착공/기성/준공 ...
  title         text not null,
  version       int not null default 1,
  storage_path  text not null,
  file_name     text not null,
  size_bytes    bigint,
  mime          text,
  contract_party text,
  contract_amount bigint,
  contract_date date,
  uploaded_by   uuid references gm.profiles(id),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 작업일보 (현장 앱)
-- ---------------------------------------------------------------------
create type gm.report_status as enum ('draft', 'submitted', 'confirmed', 'returned');

create table gm.daily_reports (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references gm.projects(id) on delete cascade,
  report_date   date not null,
  status        gm.report_status not null default 'draft',
  weather       text,
  work_note     text,                              -- 금일 공정 · 특이사항
  submitted_by  uuid references gm.profiles(id),
  submitted_at  timestamptz,
  confirmed_by  uuid references gm.profiles(id),
  confirmed_at  timestamptz,
  return_reason text,
  created_at    timestamptz not null default now(),
  unique (project_id, report_date)
);

create table gm.daily_crews (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references gm.daily_reports(id) on delete cascade,
  trade      text not null,                       -- 직종
  company    text,                                -- 소속
  headcount  int not null default 0 check (headcount >= 0),
  sort       int not null default 0
);

create table gm.daily_equipment (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references gm.daily_reports(id) on delete cascade,
  name       text not null,
  spec       text,
  kind       text not null default '임대',          -- 임대 / 직영
  hours      text,
  vendor     text,
  amount     bigint not null default 0,
  doc_path   text,                                -- 계산서 사진
  sort       int not null default 0
);

create type gm.entry_status as enum ('pending', 'approved', 'rejected');

create table gm.progress_entries (                -- 위치 × 공종 금일 수량
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references gm.daily_reports(id) on delete cascade,
  project_id    uuid not null references gm.projects(id) on delete cascade,
  location_id   uuid not null references gm.locations(id) on delete cascade,
  work_item_id  uuid not null references gm.work_items(id) on delete cascade,
  qty           numeric(14,3) not null check (qty >= 0),
  status        gm.entry_status not null default 'pending',
  note          text,
  entered_by    uuid references gm.profiles(id),
  reviewed_by   uuid references gm.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (report_id, location_id, work_item_id)
);

-- ---------------------------------------------------------------------
-- 자료요청 · 사진 · 자재
-- ---------------------------------------------------------------------
create type gm.request_status as enum ('open', 'in_progress', 'done');

create table gm.requests (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references gm.projects(id) on delete cascade,
  kind         text not null default '사진',        -- 사진 / 송장·계산서 / 수량 확인 / 서류 / 기타
  title        text not null,
  body         text,
  location_id  uuid references gm.locations(id) on delete set null,
  due_at       timestamptz,
  remind       boolean not null default true,
  from_user    uuid references gm.profiles(id),
  to_user      uuid references gm.profiles(id),
  status       gm.request_status not null default 'open',
  answer_note  text,
  answered_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table gm.photos (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references gm.projects(id) on delete cascade,
  report_id     uuid references gm.daily_reports(id) on delete set null,
  location_id   uuid references gm.locations(id) on delete set null,
  work_item_id  uuid references gm.work_items(id) on delete set null,
  request_id    uuid references gm.requests(id) on delete set null,
  kind          text not null default '시공 중',     -- 시공 전/중/후 · 자재·송장 · 안전 · 기타
  memo          text,
  storage_path  text not null,
  taken_at      timestamptz not null default now(),
  lat           double precision,
  lng           double precision,
  uploaded_by   uuid references gm.profiles(id),
  created_at    timestamptz not null default now()
);

create table gm.materials (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references gm.projects(id) on delete cascade,
  name        text not null,
  spec        text,
  unit        text not null default '개',
  design_qty  numeric(14,3) not null default 0,
  sort        int not null default 0
);

create type gm.move_kind as enum ('in', 'use');

create table gm.material_moves (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references gm.projects(id) on delete cascade,
  material_id   uuid not null references gm.materials(id) on delete cascade,
  report_id     uuid references gm.daily_reports(id) on delete set null,
  move_date     date not null default current_date,
  kind          gm.move_kind not null,
  qty           numeric(14,3) not null check (qty >= 0),
  vendor        text,
  photo_path    text,                              -- 반입 사진
  invoice_path  text,                              -- 송장 사진
  entered_by    uuid references gm.profiles(id),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 알림 · 로그
-- ---------------------------------------------------------------------
create table gm.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references gm.profiles(id) on delete cascade,
  project_id  uuid references gm.projects(id) on delete cascade,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table gm.activity_log (
  id          bigserial primary key,
  project_id  uuid references gm.projects(id) on delete set null,
  user_id     uuid references gm.profiles(id) on delete set null,
  action      text not null,
  target      text,
  reason      text,
  created_at  timestamptz not null default now()
);

create index on gm.projects (company_id);
create index on gm.documents (project_id, category);
create index on gm.daily_reports (project_id, report_date desc);
create index on gm.progress_entries (project_id, status);
create index on gm.photos (project_id, taken_at desc);
create index on gm.requests (project_id, status);
create index on gm.requests (to_user, status);
create index on gm.material_moves (project_id, material_id, move_date);
create index on gm.notifications (user_id, read_at);

-- =====================================================================
-- 권한 함수
-- =====================================================================
create or replace function gm.me() returns gm.profiles
language sql stable security definer set search_path = gm, public as $$
  select * from gm.profiles where id = auth.uid() and active
$$;

create or replace function gm.is_sysadmin() returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (select 1 from gm.profiles where id = auth.uid() and active and role = 'system_admin')
$$;

create or replace function gm.is_admin() returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (select 1 from gm.profiles where id = auth.uid() and active and role in ('system_admin', 'company_admin'))
$$;

-- 프로젝트를 볼 수 있는가
create or replace function gm.can_view(p uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (
    select 1 from gm.profiles me
    left join gm.projects pr on pr.id = p
    where me.id = auth.uid() and me.active and (
      me.role = 'system_admin'
      or (me.role = 'company_admin' and pr.company_id = me.company_id)
      or exists (select 1 from gm.project_members m where m.project_id = p and m.user_id = me.id)
    )
  )
$$;

-- 프로젝트 데이터를 수정할 수 있는가 (본사 직원 이상)
create or replace function gm.can_edit(p uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (
    select 1 from gm.profiles me
    left join gm.projects pr on pr.id = p
    where me.id = auth.uid() and me.active and (
      me.role = 'system_admin'
      or (me.role = 'company_admin' and pr.company_id = me.company_id)
      or (me.role = 'staff' and exists (select 1 from gm.project_members m where m.project_id = p and m.user_id = me.id))
    )
  )
$$;

-- 현장 입력을 할 수 있는가 (현장 담당자 포함)
create or replace function gm.can_field(p uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select gm.can_edit(p) or exists (
    select 1 from gm.profiles me
    join gm.project_members m on m.user_id = me.id and m.project_id = p
    where me.id = auth.uid() and me.active and me.role = 'field' and m.can_field
  )
$$;

create or replace function gm.report_project(r uuid) returns uuid
language sql stable security definer set search_path = gm, public as $$
  select project_id from gm.daily_reports where id = r
$$;

create or replace function gm.facility_project(f uuid) returns uuid
language sql stable security definer set search_path = gm, public as $$
  select project_id from gm.facilities where id = f
$$;

create or replace function gm.location_project(loc_id uuid) returns uuid
language sql stable security definer set search_path = gm, public as $$
  select f.project_id from gm.locations lo join gm.facilities f on f.id = lo.facility_id where lo.id = loc_id
$$;

-- =====================================================================
-- 행 단위 권한 (RLS)
-- =====================================================================
alter table gm.companies            enable row level security;
alter table gm.profiles             enable row level security;
alter table gm.projects             enable row level security;
alter table gm.project_subcontracts enable row level security;
alter table gm.project_members      enable row level security;
alter table gm.facilities           enable row level security;
alter table gm.locations            enable row level security;
alter table gm.work_items           enable row level security;
alter table gm.location_work        enable row level security;
alter table gm.documents            enable row level security;
alter table gm.daily_reports        enable row level security;
alter table gm.daily_crews          enable row level security;
alter table gm.daily_equipment      enable row level security;
alter table gm.progress_entries     enable row level security;
alter table gm.requests             enable row level security;
alter table gm.photos               enable row level security;
alter table gm.materials            enable row level security;
alter table gm.material_moves       enable row level security;
alter table gm.notifications        enable row level security;
alter table gm.activity_log         enable row level security;

-- 회사: 로그인한 사람 모두 조회, 관리자만 수정
create policy co_read  on gm.companies for select to authenticated using (true);
create policy co_write on gm.companies for all    to authenticated using (gm.is_sysadmin()) with check (gm.is_sysadmin());

-- 프로필: 모두 조회(사내 연락처), 본인은 일부 수정, 관리자는 전체
create policy pf_read   on gm.profiles for select to authenticated using (true);
create policy pf_self   on gm.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy pf_admin  on gm.profiles for all    to authenticated using (gm.is_admin()) with check (gm.is_admin());

-- 본인이 role · company · 사번 등 관리 항목을 바꾸지 못하게
create or replace function gm.protect_profile() returns trigger
language plpgsql security definer set search_path = gm, public as $$
begin
  if gm.is_admin() then return new; end if;
  new.role := old.role; new.company_id := old.company_id; new.emp_no := old.emp_no;
  new.rank := old.rank; new.position := old.position; new.dept := old.dept;
  new.hire_date := old.hire_date; new.active := old.active; new.username := old.username;
  return new;
end $$;
create trigger trg_protect_profile before update on gm.profiles for each row execute function gm.protect_profile();

-- 프로젝트
create policy pj_read   on gm.projects for select to authenticated using (gm.can_view(id));
create policy pj_insert on gm.projects for insert to authenticated with check (
  gm.is_sysadmin() or (gm.is_admin() and company_id = (gm.me()).company_id)
  or ((gm.me()).role = 'staff' and company_id = (gm.me()).company_id));
create policy pj_update on gm.projects for update to authenticated using (gm.can_edit(id)) with check (gm.can_edit(id));
create policy pj_delete on gm.projects for delete to authenticated using (gm.is_admin() and gm.can_edit(id));

-- 프로젝트에 딸린 테이블: 조회 = can_view, 수정 = can_edit
create policy sc_read  on gm.project_subcontracts for select to authenticated using (gm.can_view(project_id));
create policy sc_write on gm.project_subcontracts for all    to authenticated using (gm.can_edit(project_id)) with check (gm.can_edit(project_id));
create policy pm_read  on gm.project_members for select to authenticated using (gm.can_view(project_id));
create policy pm_write on gm.project_members for all    to authenticated using (gm.is_admin() or gm.can_edit(project_id)) with check (gm.is_admin() or gm.can_edit(project_id));
create policy fa_read  on gm.facilities for select to authenticated using (gm.can_view(project_id));
create policy fa_write on gm.facilities for all    to authenticated using (gm.can_edit(project_id)) with check (gm.can_edit(project_id));
create policy lo_read  on gm.locations  for select to authenticated using (gm.can_view(gm.facility_project(facility_id)));
create policy lo_write on gm.locations  for all    to authenticated using (gm.can_edit(gm.facility_project(facility_id))) with check (gm.can_edit(gm.facility_project(facility_id)));
create policy wi_read  on gm.work_items for select to authenticated using (gm.can_view(project_id));
create policy wi_write on gm.work_items for all    to authenticated using (gm.can_edit(project_id)) with check (gm.can_edit(project_id));
create policy lw_read  on gm.location_work for select to authenticated using (gm.can_view(gm.location_project(location_id)));
create policy lw_write on gm.location_work for all    to authenticated using (gm.can_edit(gm.location_project(location_id))) with check (gm.can_edit(gm.location_project(location_id)));
create policy dc_read  on gm.documents for select to authenticated using (gm.can_view(project_id));
create policy dc_write on gm.documents for all    to authenticated using (gm.can_edit(project_id)) with check (gm.can_edit(project_id));
create policy mt_read  on gm.materials for select to authenticated using (gm.can_view(project_id));
create policy mt_write on gm.materials for all    to authenticated using (gm.can_edit(project_id)) with check (gm.can_edit(project_id));

-- 현장 입력 테이블: 조회 = can_view, 입력 = can_field, 확인 · 승인은 트리거/앱에서 can_edit
create policy dr_read   on gm.daily_reports for select to authenticated using (gm.can_view(project_id));
create policy dr_write  on gm.daily_reports for all    to authenticated using (gm.can_field(project_id)) with check (gm.can_field(project_id));
create policy cr_read   on gm.daily_crews for select to authenticated using (gm.can_view(gm.report_project(report_id)));
create policy cr_write  on gm.daily_crews for all    to authenticated using (gm.can_field(gm.report_project(report_id))) with check (gm.can_field(gm.report_project(report_id)));
create policy eq_read   on gm.daily_equipment for select to authenticated using (gm.can_view(gm.report_project(report_id)));
create policy eq_write  on gm.daily_equipment for all    to authenticated using (gm.can_field(gm.report_project(report_id))) with check (gm.can_field(gm.report_project(report_id)));
create policy pe_read   on gm.progress_entries for select to authenticated using (gm.can_view(project_id));
create policy pe_write  on gm.progress_entries for all    to authenticated using (gm.can_field(project_id)) with check (gm.can_field(project_id));
create policy ph_read   on gm.photos for select to authenticated using (gm.can_view(project_id));
create policy ph_write  on gm.photos for all    to authenticated using (gm.can_field(project_id)) with check (gm.can_field(project_id));
create policy mm_read   on gm.material_moves for select to authenticated using (gm.can_view(project_id));
create policy mm_write  on gm.material_moves for all    to authenticated using (gm.can_field(project_id)) with check (gm.can_field(project_id));
create policy rq_read   on gm.requests for select to authenticated using (gm.can_view(project_id));
create policy rq_insert on gm.requests for insert to authenticated with check (gm.can_edit(project_id));
create policy rq_update on gm.requests for update to authenticated using (gm.can_edit(project_id) or to_user = auth.uid()) with check (gm.can_edit(project_id) or to_user = auth.uid());
create policy rq_delete on gm.requests for delete to authenticated using (gm.can_edit(project_id));

create policy nt_own on gm.notifications for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy lg_read on gm.activity_log for select to authenticated using (gm.is_admin() or (project_id is not null and gm.can_view(project_id)));
create policy lg_ins  on gm.activity_log for insert to authenticated with check (user_id = auth.uid());

-- 현장 담당자는 수량 승인 상태를 바꿀 수 없게 (승인은 본사)
create or replace function gm.protect_entry() returns trigger
language plpgsql security definer set search_path = gm, public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and not gm.can_edit(new.project_id) then
    raise exception '수량 승인은 본사 담당자만 할 수 있습니다';
  end if;
  if tg_op = 'INSERT' and new.status <> 'pending' and not gm.can_edit(new.project_id) then
    new.status := 'pending';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  end if;
  return new;
end $$;
create trigger trg_protect_entry before insert or update on gm.progress_entries for each row execute function gm.protect_entry();

-- 작업일보 확인 · 반려는 본사만
create or replace function gm.protect_report() returns trigger
language plpgsql security definer set search_path = gm, public as $$
begin
  if new.status in ('confirmed', 'returned') and new.status is distinct from old.status and not gm.can_edit(new.project_id) then
    raise exception '작업일보 확인은 본사 담당자만 할 수 있습니다';
  end if;
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.submitted_by := auth.uid(); new.submitted_at := now();
  end if;
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    new.confirmed_by := auth.uid(); new.confirmed_at := now();
  end if;
  return new;
end $$;
create trigger trg_protect_report before update on gm.daily_reports for each row execute function gm.protect_report();

-- 자료요청이 생기면 받는 사람에게 알림
create or replace function gm.notify_request() returns trigger
language plpgsql security definer set search_path = gm, public as $$
declare pname text;
begin
  select name into pname from gm.projects where id = new.project_id;
  if tg_op = 'INSERT' and new.to_user is not null then
    insert into gm.notifications (user_id, project_id, title, body, link)
    values (new.to_user, new.project_id, '[' || pname || '] 자료요청', new.title, '/field/requests');
  elsif tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done' and new.from_user is not null then
    insert into gm.notifications (user_id, project_id, title, body, link)
    values (new.from_user, new.project_id, '[' || pname || '] 요청 완료', new.title, '/projects/' || new.project_id || '/site');
  end if;
  return new;
end $$;
create trigger trg_notify_request after insert or update on gm.requests for each row execute function gm.notify_request();

-- 작업일보 제출 시 프로젝트 담당 본사 직원에게 알림
create or replace function gm.notify_report() returns trigger
language plpgsql security definer set search_path = gm, public as $$
declare pname text;
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    select name into pname from gm.projects where id = new.project_id;
    insert into gm.notifications (user_id, project_id, title, body, link)
    select m.user_id, new.project_id, '[' || pname || '] 작업일보 제출', to_char(new.report_date, 'MM/DD') || ' 일보가 제출되었습니다',
           '/projects/' || new.project_id || '/site'
    from gm.project_members m join gm.profiles p on p.id = m.user_id
    where m.project_id = new.project_id and p.role in ('staff', 'company_admin', 'system_admin');
  end if;
  return new;
end $$;
create trigger trg_notify_report after update on gm.daily_reports for each row execute function gm.notify_report();

-- =====================================================================
-- 공정률 뷰 (승인된 입력만 · 금액 기준)
--   위치·공종 금액 = trunc(누계수량 × 도급단가)
--   공정률 = Σ 실적금액 ÷ Σ trunc(설계수량 × 도급단가)
-- =====================================================================
create or replace view gm.v_location_progress with (security_invoker = true) as
select
  f.project_id,
  f.id   as facility_id, f.name as facility_name, f.sort as facility_sort,
  l.id   as location_id, l.name as location_name, l.sort as location_sort,
  w.id   as work_item_id, w.name as work_name, w.unit, w.unit_price, w.sort as work_sort,
  lw.design_qty,
  coalesce(sum(pe.qty) filter (where pe.status = 'approved'), 0) as done_qty,
  coalesce(sum(pe.qty) filter (where pe.status = 'pending'), 0)  as pending_qty,
  trunc(lw.design_qty * w.unit_price)::bigint as design_amount,
  trunc(coalesce(sum(pe.qty) filter (where pe.status = 'approved'), 0) * w.unit_price)::bigint as done_amount
from gm.location_work lw
join gm.locations  l on l.id = lw.location_id
join gm.facilities f on f.id = l.facility_id
join gm.work_items w on w.id = lw.work_item_id
left join gm.progress_entries pe on pe.location_id = lw.location_id and pe.work_item_id = lw.work_item_id
group by f.project_id, f.id, l.id, w.id, lw.design_qty;

create or replace view gm.v_project_summary with (security_invoker = true) as
select
  p.id as project_id,
  coalesce(sum(v.design_amount), 0)::bigint as design_amount,
  coalesce(sum(v.done_amount), 0)::bigint   as done_amount,
  case when coalesce(sum(v.design_amount), 0) = 0 then 0
       else round(sum(v.done_amount)::numeric * 100 / sum(v.design_amount), 1) end as progress_pct,
  (select coalesce(sum(s.amount), 0) from gm.project_subcontracts s where s.project_id = p.id)::bigint as sub_amount
from gm.projects p
left join gm.v_location_progress v on v.project_id = p.id
group by p.id;

create or replace view gm.v_material_ledger with (security_invoker = true) as
select
  m.id as material_id, m.project_id, m.name, m.spec, m.unit, m.design_qty,
  coalesce(sum(mm.qty) filter (where mm.kind = 'in'), 0)  as in_qty,
  coalesce(sum(mm.qty) filter (where mm.kind = 'use'), 0) as use_qty,
  coalesce(sum(mm.qty) filter (where mm.kind = 'in'), 0) - coalesce(sum(mm.qty) filter (where mm.kind = 'use'), 0) as stock_qty
from gm.materials m
left join gm.material_moves mm on mm.material_id = m.id
group by m.id;

-- =====================================================================
-- 권한 부여 (API로 노출)
-- =====================================================================
grant select, insert, update, delete on all tables in schema gm to authenticated;
grant usage, select on all sequences in schema gm to authenticated;
grant all on all tables in schema gm to service_role;
grant all on all sequences in schema gm to service_role;
grant execute on all functions in schema gm to authenticated, service_role;

-- =====================================================================
-- 파일 저장소 (Supabase Storage)
--   경로 규칙: {project_id}/{분류}/{파일}
-- =====================================================================
-- 다른 앱(호비스 등)의 파일 경로가 uuid가 아니어도 오류 나지 않게 안전하게 변환
create or replace function gm.try_uuid(t text) returns uuid
language sql immutable as $$
  select case when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid end
$$;
grant execute on function gm.try_uuid(text) to authenticated, service_role;

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

create policy "gm_files_read" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and gm.can_view(gm.try_uuid((storage.foldername(name))[1])));
create policy "gm_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and gm.can_field(gm.try_uuid((storage.foldername(name))[1])));
create policy "gm_files_update" on storage.objects for update to authenticated
  using (bucket_id = 'project-files' and gm.can_edit(gm.try_uuid((storage.foldername(name))[1])));
create policy "gm_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and gm.can_edit(gm.try_uuid((storage.foldername(name))[1])));

-- 실시간 알림 (Supabase Realtime)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table gm.notifications, gm.requests, gm.daily_reports;
  end if;
end $$;

-- =====================================================================
-- 기본 데이터: 3개 회사
-- =====================================================================
insert into gm.companies (code, name, sort) values
  ('gmroad', '지엠로드', 1),
  ('gmr', '지엠알', 2),
  ('oo-eng', 'OO엔지니어링', 3)
on conflict (code) do nothing;
