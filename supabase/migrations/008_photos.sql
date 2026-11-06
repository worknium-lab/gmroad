-- 008 · 사진 전용 앱 : 프로젝트별 › 날짜별 사진첩 + 사진대지
--   * 사진 날짜는 한국 시간 기준 촬영일(taken_day)로 묶음
--   * 현장 담당자는 자기가 올린 사진만 고치거나 지움 (본사 can_edit은 전부)
--   * 사진대지(photo_sheets): 고른 사진 + 설명 + 한 쪽에 몇 장 — 인쇄 · 엑셀로 냄

alter table gm.photos add column if not exists taken_day date
  generated always as ((taken_at at time zone 'Asia/Seoul')::date) stored;
alter table gm.photos add column if not exists caption text;          -- 사진대지에 쓰는 설명 (없으면 자동 문구)
alter table gm.photos add column if not exists thumb_path text;      -- 목록용 작은 사진 (긴 변 480px)
alter table gm.photos add column if not exists width  int;
alter table gm.photos add column if not exists height int;
create index if not exists photos_project_day on gm.photos (project_id, taken_day desc, taken_at desc);

-- 권한: 보기 = can_view, 올리기 = can_field, 고치기 · 지우기 = 본사(can_edit) 또는 올린 사람
drop policy if exists ph_write on gm.photos;
create policy ph_insert on gm.photos for insert to authenticated
  with check (gm.can_field(project_id) and (uploaded_by is null or uploaded_by = auth.uid()));
create policy ph_update on gm.photos for update to authenticated
  using (gm.can_edit(project_id) or (gm.can_field(project_id) and uploaded_by = auth.uid()))
  with check (gm.can_field(project_id));
create policy ph_delete on gm.photos for delete to authenticated
  using (gm.can_edit(project_id) or (gm.can_field(project_id) and uploaded_by = auth.uid()));

-- 날짜 목록 (RLS 그대로 적용되도록 invoker)
create or replace function gm.photo_days(p uuid)
returns table (day date, n int, cover text, kinds text[])
language sql stable security invoker set search_path = gm, public as $$
  select taken_day, count(*)::int,
         (array_agg(coalesce(thumb_path, storage_path) order by taken_at desc))[1],
         array_agg(distinct kind)
  from gm.photos where project_id = p
  group by taken_day order by taken_day desc
$$;

-- 내가 볼 수 있는 프로젝트별 사진 수 · 최근 날짜 · 표지
create or replace function gm.photo_projects()
returns table (project_id uuid, name text, status text, n int, last_day date, cover text)
language sql stable security invoker set search_path = gm, public as $$
  select pr.id, pr.name, pr.status, count(ph.id)::int, max(ph.taken_day),
         (array_agg(coalesce(ph.thumb_path, ph.storage_path) order by ph.taken_at desc) filter (where ph.id is not null))[1]
  from gm.projects pr left join gm.photos ph on ph.project_id = pr.id
  group by pr.id, pr.name, pr.status
  order by max(ph.taken_at) desc nulls last, pr.name
$$;

-- 사진대지
create table gm.photo_sheets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references gm.projects(id) on delete cascade,
  title       text not null default '사진대지',
  per_page    int  not null default 3 check (per_page in (2, 3, 4, 6)),
  items       jsonb not null default '[]',   -- [{photo_id, caption}]
  created_by  uuid references gm.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on gm.photo_sheets (project_id, updated_at desc);
alter table gm.photo_sheets enable row level security;
create policy pst_read  on gm.photo_sheets for select to authenticated using (gm.can_view(project_id));
create policy pst_write on gm.photo_sheets for all to authenticated using (gm.can_field(project_id)) with check (gm.can_field(project_id));

grant select, insert, update, delete on gm.photo_sheets to authenticated;
grant execute on function gm.photo_days(uuid), gm.photo_projects() to authenticated;
