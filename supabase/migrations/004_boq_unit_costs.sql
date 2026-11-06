-- =====================================================================
-- ④ 내역서 3: 변경 때 새로 쓰는 일위대가(호표) · 단가산출서
--   변경내역서(작성 중)에 딸리고, 엑셀에는 '신규 일위대가' · '신규 단가산출' 시트로 들어갑니다.
-- =====================================================================

-- 내역서를 고칠 수 있는가: 내역서 권한 + 조회 전용 · 현장이 아닌 사람
create or replace function gm.can_boq_edit(p uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select gm.can_boq(p) and exists (select 1 from gm.profiles me where me.id = auth.uid() and me.role in ('system_admin', 'company_admin', 'staff'))
$$;
grant execute on function gm.can_boq_edit(uuid) to authenticated, service_role;

-- 변경내역서가 작성 중(잠기지 않음)인가
create or replace function gm.boq_draft(rev uuid, p uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (select 1 from gm.boq_revisions r where r.id = rev and r.project_id = p and r.kind = 'change' and not r.locked and r.status <> 'confirmed')
$$;
grant execute on function gm.boq_draft(uuid, uuid) to authenticated, service_role;

create table gm.boq_unit_costs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references gm.projects(id) on delete cascade,
  revision_id  uuid not null references gm.boq_revisions(id) on delete cascade,
  seq          int not null default 1,                 -- 신규 1, 신규 2 …
  name         text not null,
  spec         text,
  unit         text,
  basis        text,                                   -- 산출 근거 (품셈 등)
  apply_rate   boolean not null default true,          -- 적용 단가에 낙찰률 곱하기
  lines        jsonb not null default '[]',            -- [{ name, spec, unit, qty, mat|lab|exp: { v | f | quote }, src }]
  copied_from  text,
  created_by   uuid references gm.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on gm.boq_unit_costs (revision_id, seq);

create table gm.boq_quotes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references gm.projects(id) on delete cascade,
  revision_id  uuid not null references gm.boq_revisions(id) on delete cascade,
  seq          int not null default 1,
  name         text not null,
  spec         text,
  unit         text,
  sources      jsonb not null default '[{},{},{}]',    -- 물가정보 · 거래가격 · 견적: [{ price, ref, file_path, file_name }]
  method       text not null default 'min' check (method in ('min', 'avg', 'pick')),
  pick         int not null default 0,
  note         text,
  created_by   uuid references gm.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on gm.boq_quotes (revision_id, seq);

alter table gm.boq_unit_costs enable row level security;
alter table gm.boq_quotes enable row level security;
create policy buc_read on gm.boq_unit_costs for select to authenticated using (gm.can_boq(project_id));
create policy buc_write on gm.boq_unit_costs for all to authenticated
  using (gm.can_boq_edit(project_id) and gm.boq_draft(revision_id, project_id))
  with check (gm.can_boq_edit(project_id) and gm.boq_draft(revision_id, project_id));
create policy bq_read on gm.boq_quotes for select to authenticated using (gm.can_boq(project_id));
create policy bq_write on gm.boq_quotes for all to authenticated
  using (gm.can_boq_edit(project_id) and gm.boq_draft(revision_id, project_id))
  with check (gm.can_boq_edit(project_id) and gm.boq_draft(revision_id, project_id));

grant select, insert, update, delete on gm.boq_unit_costs, gm.boq_quotes to authenticated;
grant all on gm.boq_unit_costs, gm.boq_quotes to service_role;
