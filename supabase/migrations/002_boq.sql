-- =====================================================================
-- ④ 내역서: 차수(설계 · 도급 · 변경 · 준공)와 항목
--   원본 엑셀 파일이 기준이고, 항목 표는 화면 표시 · 검색 · 공종 연결용 사본입니다.
--   쓰기는 관리 API(service role)가 하고, 화면은 읽기만 합니다.
-- =====================================================================

create type gm.boq_kind as enum ('design', 'contract', 'change', 'final');

create table gm.boq_revisions (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references gm.projects(id) on delete cascade,
  kind           gm.boq_kind not null,
  seq            int not null default 0,                 -- 변경 차수 (1차, 2차 …)
  title          text not null,
  status         text not null default 'draft',          -- draft / confirmed
  locked         boolean not null default false,
  base_id        uuid references gm.boq_revisions(id) on delete set null,
  source_document_id uuid references gm.documents(id) on delete set null,
  storage_path   text not null,                          -- 이 차수의 엑셀 파일
  file_name      text not null,
  sheet_name     text not null,
  header_row     int not null,
  col_map        jsonb not null,
  totals         jsonb not null default '{}',
  params         jsonb not null default '{}',            -- 낙찰률 · 고정 줄 · 계약금액 · 결과
  check_result   jsonb not null default '{}',            -- 가져올 때 엑셀값과 대조한 결과
  created_by     uuid references gm.profiles(id),
  created_at     timestamptz not null default now(),
  confirmed_by   uuid references gm.profiles(id),
  confirmed_at   timestamptz
);
create index on gm.boq_revisions (project_id, kind, seq);

create table gm.boq_items (
  id           uuid primary key default gen_random_uuid(),
  revision_id  uuid not null references gm.boq_revisions(id) on delete cascade,
  row          int not null,                 -- 엑셀 행 번호
  parent_row   int,
  level        int not null default 0,
  kind         text not null,                -- item / link / group / cost
  section      text not null,                -- summary(원가계산 요약) / detail(공종 상세)
  name         text not null default '',
  spec         text,
  unit         text,
  qty          numeric(18,4),
  mat_price    numeric(18,4), lab_price numeric(18,4), exp_price numeric(18,4),
  mat_amt      bigint not null default 0, lab_amt bigint not null default 0, exp_amt bigint not null default 0,
  total_amt    bigint not null default 0,
  note         text,
  price_ref    text,                         -- 단가 출처 수식 (예: 일위대가목록!F3)
  unique (revision_id, row)
);
create index on gm.boq_items (revision_id, row);

-- 내역서 · 금액을 볼 수 있는가: 관리자, 또는 프로젝트 참여자 중 '내역서·금액' 권한
create or replace function gm.can_boq(p uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (
    select 1 from gm.profiles me
    left join gm.projects pr on pr.id = p
    where me.id = auth.uid() and me.active and (
      me.role = 'system_admin'
      or (me.role = 'company_admin' and pr.company_id = me.company_id)
      or exists (select 1 from gm.project_members m where m.project_id = p and m.user_id = me.id and m.can_boq)
    )
  )
$$;
grant execute on function gm.can_boq(uuid) to authenticated, service_role;

alter table gm.boq_revisions enable row level security;
alter table gm.boq_items enable row level security;
create policy br_read on gm.boq_revisions for select to authenticated using (gm.can_boq(project_id));
create policy bi_read on gm.boq_items for select to authenticated
  using (exists (select 1 from gm.boq_revisions r where r.id = revision_id and gm.can_boq(r.project_id)));

grant select on gm.boq_revisions, gm.boq_items to authenticated;
grant all on gm.boq_revisions, gm.boq_items to service_role;
