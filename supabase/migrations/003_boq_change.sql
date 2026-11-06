-- =====================================================================
-- ④ 내역서 2: 변경내역서 · 확정 · 준공내역서 · 잠금 해제 비밀번호 · 이력
-- =====================================================================

-- 변경내역서 항목: 기본 칸 = 변경 값, orig = 당초 값
alter table gm.boq_items
  add column orig    jsonb,                 -- { qty, mat_price, lab_price, exp_price, mat_amt, lab_amt, exp_amt, total_amt }
  add column change  text,                  -- same / qty / price / amt / new / del
  add column xl_row  int,                   -- 엑셀에서 (변경) 줄의 행 번호
  add column new_id  text;                  -- 신규 항목 구분값

-- 발주처별 표기 규칙 (윗줄이 변경인지 당초인지, 글자색, 품명 칸 합치기)
create table gm.boq_client_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references gm.companies(id) on delete cascade,
  client      text not null,
  top         text not null default 'change' check (top in ('change', 'orig')),
  orig_color  text not null default 'black',
  chg_color   text not null default 'red',
  merge_text  boolean not null default true,
  updated_by  uuid references gm.profiles(id),
  updated_at  timestamptz not null default now(),
  unique (company_id, client)
);

-- 확정 잠금 해제 비밀번호 (회사별, 해시만 저장 · 화면에서는 못 읽음)
create table gm.boq_secrets (
  company_id  uuid primary key references gm.companies(id) on delete cascade,
  unlock_hash text not null,
  updated_by  uuid references gm.profiles(id),
  updated_at  timestamptz not null default now()
);

-- 내역서 이력 (생성 · 저장 · 확정 · 잠금 해제 · 삭제)
create table gm.boq_logs (
  id           bigserial primary key,
  project_id   uuid not null references gm.projects(id) on delete cascade,
  revision_id  uuid references gm.boq_revisions(id) on delete set null,
  revision_title text,
  action       text not null,
  reason       text,
  detail       jsonb not null default '{}',
  user_id      uuid references gm.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on gm.boq_logs (project_id, created_at desc);

alter table gm.boq_client_rules enable row level security;
alter table gm.boq_secrets enable row level security;
alter table gm.boq_logs enable row level security;
create policy bcr_read on gm.boq_client_rules for select to authenticated using (true);
create policy bl_read on gm.boq_logs for select to authenticated using (gm.can_boq(project_id));
-- boq_secrets: 읽기 정책 없음 (API만)

grant select on gm.boq_client_rules, gm.boq_logs to authenticated;
grant all on gm.boq_client_rules, gm.boq_secrets, gm.boq_logs to service_role;
grant usage, select on sequence gm.boq_logs_id_seq to service_role;
