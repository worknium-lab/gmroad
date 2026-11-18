-- =====================================================================
-- ④ 내역서 4: 차수 · 기성 · 공종 ↔ 내역 항목 연결
--   차수: 장기계속공사에서 도급(준공)내역서 수량을 연차별로 나눔
--   기성: 회차마다 금회 수량. 확정하면 고칠 수 없음 (관리자만 확정 취소)
--   연결: ⑦ 공정률의 공종(work_items)이 내역서의 어느 항목(엑셀 행)인지 — 현장 승인 수량을 기성으로 불러올 때 씀
--   수량은 { "엑셀 행": 수량 } jsonb. 금액은 화면이 적산 엔진으로 계산 (행 × 단가, 원 미만 버림)
-- =====================================================================

create table gm.boq_phases (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references gm.projects(id) on delete cascade,
  revision_id  uuid not null references gm.boq_revisions(id) on delete cascade,   -- 나눌 기준 (도급 · 준공내역서)
  seq          int not null,                                                    -- 1차, 2차 …
  name         text not null,
  alloc        jsonb not null default '{}',                                     -- { "행": 수량 }
  updated_by   uuid references gm.profiles(id) default auth.uid(),
  updated_at   timestamptz not null default now(),
  unique (revision_id, seq)
);

create table gm.boq_rounds (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references gm.projects(id) on delete cascade,
  revision_id  uuid not null references gm.boq_revisions(id),                    -- 이 회차의 기준 내역서 (지우지 못하게 cascade 없음)
  seq          int not null,                                                    -- 1회, 2회 …
  title        text not null,
  period_from  date,
  period_to    date,
  qty          jsonb not null default '{}',                                     -- 금회 수량 { "행": 수량 }
  status       text not null default 'draft' check (status in ('draft', 'confirmed')),
  note         text,
  created_by   uuid references gm.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  confirmed_by uuid references gm.profiles(id),
  confirmed_at timestamptz,
  unique (project_id, seq)
);
create index on gm.boq_rounds (project_id, seq);

create table gm.boq_work_links (
  work_item_id uuid primary key references gm.work_items(id) on delete cascade,
  project_id   uuid not null references gm.projects(id) on delete cascade,
  revision_id  uuid not null references gm.boq_revisions(id) on delete cascade,
  boq_row      int not null,
  updated_by   uuid references gm.profiles(id) default auth.uid(),
  updated_at   timestamptz not null default now()
);

-- 기준 내역서 · 공종이 같은 프로젝트 것인지
create or replace function gm.boq_same_project() returns trigger
language plpgsql security definer set search_path = gm, public as $$
begin
  if not exists (select 1 from gm.boq_revisions r where r.id = new.revision_id and r.project_id = new.project_id) then
    raise exception '기준 내역서가 이 프로젝트 것이 아닙니다';
  end if;
  -- 공종 검사는 연결 표에만 (차수 표에는 work_item_id 칸이 없어 따로 나눔)
  if tg_table_name = 'boq_work_links' then
    if not exists (select 1 from gm.work_items w where w.id = (to_jsonb(new) ->> 'work_item_id')::uuid and w.project_id = new.project_id) then
      raise exception '공종이 이 프로젝트 것이 아닙니다';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_phase_project before insert or update on gm.boq_phases for each row execute function gm.boq_same_project();
create trigger trg_link_project before insert or update on gm.boq_work_links for each row execute function gm.boq_same_project();

-- 기성 회차 보호: 확정된 회차는 고치기 · 지우기 금지. 관리자만 확정 취소(수량은 그대로)
create or replace function gm.protect_boq_round() returns trigger
language plpgsql security definer set search_path = gm, public as $$
declare
  admin boolean := auth.uid() is null or exists (select 1 from gm.profiles me where me.id = auth.uid() and me.role in ('system_admin', 'company_admin'));
begin
  if tg_op = 'DELETE' then
    if old.status = 'confirmed' then raise exception '확정된 기성 회차는 지울 수 없습니다'; end if;
    return old;
  end if;
  if not exists (select 1 from gm.boq_revisions r where r.id = new.revision_id and r.project_id = new.project_id) then
    raise exception '기준 내역서가 이 프로젝트 것이 아닙니다';
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    if not (admin and new.status = 'draft' and new.qty = old.qty and new.revision_id = old.revision_id) then
      raise exception '확정된 기성 회차는 고칠 수 없습니다 (관리자가 확정을 취소한 뒤 고치세요)';
    end if;
    new.confirmed_by := null; new.confirmed_at := null;
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then
    new.confirmed_by := auth.uid(); new.confirmed_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_protect_round before insert or update or delete on gm.boq_rounds for each row execute function gm.protect_boq_round();

alter table gm.boq_phases enable row level security;
alter table gm.boq_rounds enable row level security;
alter table gm.boq_work_links enable row level security;
create policy bph_read on gm.boq_phases for select to authenticated using (gm.can_boq(project_id));
create policy bph_write on gm.boq_phases for all to authenticated using (gm.can_boq_edit(project_id)) with check (gm.can_boq_edit(project_id));
create policy brd_read on gm.boq_rounds for select to authenticated using (gm.can_boq(project_id));
create policy brd_write on gm.boq_rounds for all to authenticated using (gm.can_boq_edit(project_id)) with check (gm.can_boq_edit(project_id));
create policy bwl_read on gm.boq_work_links for select to authenticated using (gm.can_boq(project_id));
create policy bwl_write on gm.boq_work_links for all to authenticated using (gm.can_boq_edit(project_id)) with check (gm.can_boq_edit(project_id));

grant select, insert, update, delete on gm.boq_phases, gm.boq_rounds, gm.boq_work_links to authenticated;
grant all on gm.boq_phases, gm.boq_rounds, gm.boq_work_links to service_role;
