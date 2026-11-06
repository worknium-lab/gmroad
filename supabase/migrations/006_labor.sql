-- =====================================================================
-- ⑨ 노무비: 전자카드 근무내역 → 노무비 명세서 → 근로계약서 (엑셀 수식 포함)
--   근로자 주소 · 연락처 · 계좌는 '노무비' 권한(can_labor)이 있는 사람만 봅니다.
-- =====================================================================

create or replace function gm.can_labor(p uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (
    select 1 from gm.profiles me
    left join gm.projects pr on pr.id = p
    where me.id = auth.uid() and me.active and (
      me.role = 'system_admin'
      or (me.role = 'company_admin' and pr.company_id = me.company_id)
      or (me.role = 'staff' and exists (select 1 from gm.project_members m where m.project_id = p and m.user_id = me.id and m.can_labor))
    )
  )
$$;
grant execute on function gm.can_labor(uuid) to authenticated, service_role;

-- 현장별 설정 (현장명 · 사업주 · 근로조건 · 공제 요율) 과 직종별 일급
create table gm.labor_settings (
  project_id  uuid primary key references gm.projects(id) on delete cascade,
  settings    jsonb not null default '{}',
  job_rates   jsonb not null default '[]',            -- [{ job, wage }]
  updated_by  uuid references gm.profiles(id) default auth.uid(),
  updated_at  timestamptz not null default now()
);

-- 현장 근로자 명부 (달이 바뀌어도 입력값 유지)
create table gm.labor_workers (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references gm.projects(id) on delete cascade,
  name        text not null,
  birth       text not null default '',
  job         text,
  wage        bigint,                                  -- 비우면 직종 단가
  ins         text not null default '자동' check (ins in ('자동', '적용', '제외')),
  addr        text, tel text, bank text, acct text,
  updated_at  timestamptz not null default now(),
  unique (project_id, name, birth)
);

-- 월별 노무비 (전자카드 원본 · 출역 기록 · 결과 엑셀)
create table gm.labor_months (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references gm.projects(id) on delete cascade,
  ym           text not null check (ym ~ '^\d{4}-\d{2}$'),
  source_path  text,
  source_name  text,
  col_map      jsonb not null default '{}',
  records      jsonb not null default '[]',            -- [{ name, birth, date, job, tin, tout, taps, override }]
  totals       jsonb not null default '{}',            -- { heads, total, amount, ded, net }
  output_path  text,
  output_at    timestamptz,
  locked       boolean not null default false,
  confirmed_by uuid references gm.profiles(id),
  confirmed_at timestamptz,
  created_by   uuid references gm.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, ym)
);

alter table gm.labor_settings enable row level security;
alter table gm.labor_workers enable row level security;
alter table gm.labor_months enable row level security;

create policy ls_all on gm.labor_settings for all to authenticated using (gm.can_labor(project_id)) with check (gm.can_labor(project_id));
create policy lw2_all on gm.labor_workers for all to authenticated using (gm.can_labor(project_id)) with check (gm.can_labor(project_id));
create policy lm_read on gm.labor_months for select to authenticated using (gm.can_labor(project_id));
create policy lm_insert on gm.labor_months for insert to authenticated with check (gm.can_labor(project_id) and not locked);
-- 확정(잠금)은 화면에서 할 수 있지만, 푸는 것은 비밀번호가 있는 관리 API만
create policy lm_update on gm.labor_months for update to authenticated using (gm.can_labor(project_id) and not locked) with check (gm.can_labor(project_id));
create policy lm_delete on gm.labor_months for delete to authenticated using (gm.can_labor(project_id) and not locked);

grant select, insert, update, delete on gm.labor_settings, gm.labor_workers, gm.labor_months to authenticated;
grant all on gm.labor_settings, gm.labor_workers, gm.labor_months to service_role;
