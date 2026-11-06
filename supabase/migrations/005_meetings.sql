-- =====================================================================
-- ⑩ 회의록 · 프로젝트 스토리 · 프로젝트 알림칸
--   회의록은 프로젝트 안의 기록입니다 (녹음 · 수기 스캔 · 태블릿 노트).
--   받아쓰기 · 요약 · 글자 인식은 관리 API가 하고, 결과를 이 표에 씁니다.
-- =====================================================================

create table gm.meetings (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references gm.projects(id) on delete cascade,
  title          text not null,
  held_at        timestamptz not null default now(),
  kind           text not null default '정례',          -- 정례 / 감리 협의 / 발주처 / 협력사 / 내부 / 기타
  place          text,
  attendees      jsonb not null default '[]',           -- [{ name, org }]
  agenda         text,
  methods        text[] not null default '{}',          -- rec(녹음) / hand(수기) / note(태블릿 노트)
  status         text not null default 'draft'
                 check (status in ('draft', 'processing', 'transcribed', 'summarized', 'reviewed', 'error')),
  progress       text,                                  -- 처리 중 안내 (받아쓰기 40% …)
  error          text,
  consent        boolean not null default false,        -- 참석자에게 녹음 사실을 알림
  consent_by     uuid references gm.profiles(id),
  consent_at     timestamptz,
  audio_path     text,
  audio_seconds  int,
  transcript     jsonb not null default '[]',           -- [{ start, end, speaker, text }]
  summary        jsonb not null default '{}',           -- { one_line, agenda: [{ title, points, start }], decisions: [], open_issues: [] }
  pages          jsonb not null default '[]',           -- 수기 · 노트 쪽: [{ path, kind: hand|note, text, strokes_path, needs_check: [] }]
  note_text      text,                                  -- 직접 쓴 메모 (키보드)
  alerts_on      boolean not null default true,         -- 결정사항 · 기한 있는 할 일을 프로젝트 알림칸에 올림
  locked         boolean not null default false,
  confirmed_by   uuid references gm.profiles(id),
  confirmed_at   timestamptz,
  created_by     uuid references gm.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on gm.meetings (project_id, held_at desc);

create table gm.meeting_todos (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references gm.meetings(id) on delete cascade,
  project_id   uuid not null references gm.projects(id) on delete cascade,
  text         text not null,
  assignee_id  uuid references gm.profiles(id) on delete set null,
  assignee_name text,                                   -- 외부 참석자(감리 · 발주처)일 때
  due_date     date,
  done         boolean not null default false,
  done_at      timestamptz,
  request_id   uuid references gm.requests(id) on delete set null,   -- 현장 '본사 자료요청'으로 보냈을 때
  source       text not null default 'manual',     -- manual / ai (요약에서 뽑음)
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index on gm.meeting_todos (project_id, done, due_date);

-- 프로젝트 알림칸: 회의록에서 가장 중요한 것 (결정 · 기한 임박 할 일 · 미결 · 자료요청)
create table gm.project_alerts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references gm.projects(id) on delete cascade,
  meeting_id  uuid references gm.meetings(id) on delete cascade,
  todo_id     uuid references gm.meeting_todos(id) on delete cascade,
  kind        text not null check (kind in ('decision', 'todo', 'open', 'request', 'notice')),
  text        text not null,
  due_date    date,
  pinned      boolean not null default false,
  closed      boolean not null default false,          -- 해결 · 내림
  auto        boolean not null default false,          -- 회의록 확정 때 자동으로 올림
  created_by  uuid references gm.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on gm.project_alerts (project_id, closed, created_at desc);

create table gm.alert_acks (
  alert_id  uuid not null references gm.project_alerts(id) on delete cascade,
  user_id   uuid not null references gm.profiles(id) on delete cascade,
  acked_at  timestamptz not null default now(),
  primary key (alert_id, user_id)
);

-- 회의록을 쓸 수 있는가: 조회 전용이 아닌 프로젝트 참여자 (현장 담당자도 현장 회의를 녹음)
create or replace function gm.can_write_meeting(p uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select gm.can_edit(p) or gm.can_field(p)
$$;
grant execute on function gm.can_write_meeting(uuid) to authenticated, service_role;

create or replace function gm.meeting_project(m uuid) returns uuid
language sql stable security definer set search_path = gm, public as $$ select project_id from gm.meetings where id = m $$;
grant execute on function gm.meeting_project(uuid) to authenticated, service_role;

alter table gm.meetings enable row level security;
alter table gm.meeting_todos enable row level security;
alter table gm.project_alerts enable row level security;
alter table gm.alert_acks enable row level security;

create policy mg_read on gm.meetings for select to authenticated using (gm.can_view(project_id));
create policy mg_insert on gm.meetings for insert to authenticated with check (gm.can_write_meeting(project_id));
-- 고치기: 잠기지 않았고 (본사 편집 권한이거나 내가 만든 회의록)
create policy mg_update on gm.meetings for update to authenticated
  using (not locked and (gm.can_edit(project_id) or created_by = auth.uid()))
  with check (not locked and (gm.can_edit(project_id) or created_by = auth.uid()));
create policy mg_delete on gm.meetings for delete to authenticated using (not locked and (gm.can_edit(project_id) or created_by = auth.uid()));

create policy mt2_read on gm.meeting_todos for select to authenticated using (gm.can_view(project_id));
create policy mt2_write on gm.meeting_todos for all to authenticated
  using (gm.can_write_meeting(project_id) or assignee_id = auth.uid())
  with check (gm.can_write_meeting(project_id) or assignee_id = auth.uid());

create policy pa_read on gm.project_alerts for select to authenticated using (gm.can_view(project_id));
create policy pa_write on gm.project_alerts for all to authenticated using (gm.can_edit(project_id)) with check (gm.can_edit(project_id));

create policy ak_read on gm.alert_acks for select to authenticated using (user_id = auth.uid());
create policy ak_write on gm.alert_acks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 잠긴 회의록의 할 일 체크는 담당자 · 편집자가 계속 할 수 있음 (내용은 못 바꿈)
create or replace function gm.protect_todo() returns trigger
language plpgsql security definer set search_path = gm, public as $$
begin
  if (select locked from gm.meetings where id = coalesce(new.meeting_id, old.meeting_id)) and auth.uid() is not null then
    if tg_op <> 'UPDATE' or new.text is distinct from old.text or new.due_date is distinct from old.due_date
       or new.assignee_id is distinct from old.assignee_id or new.assignee_name is distinct from old.assignee_name then
      raise exception '확정된 회의록의 할 일은 완료 체크만 할 수 있습니다';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.done and not coalesce(old.done, false) then new.done_at := now(); end if;
  if not new.done then new.done_at := null; end if;
  return new;
end $$;
create trigger trg_protect_todo before insert or update or delete on gm.meeting_todos for each row execute function gm.protect_todo();

-- 할 일 담당자에게 알림
create or replace function gm.notify_todo() returns trigger
language plpgsql security definer set search_path = gm, public as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into gm.notifications (user_id, project_id, title, body, link)
    values (new.assignee_id, new.project_id, '회의 할 일이 배정되었습니다', new.text || coalesce(' · 기한 ' || new.due_date, ''),
            '/projects/' || new.project_id || '/meeting');
  end if;
  return new;
end $$;
create trigger trg_notify_todo after insert or update on gm.meeting_todos for each row execute function gm.notify_todo();

grant select, insert, update, delete on gm.meetings, gm.meeting_todos, gm.project_alerts, gm.alert_acks to authenticated;
grant all on gm.meetings, gm.meeting_todos, gm.project_alerts, gm.alert_acks to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table gm.meetings, gm.project_alerts;
  end if;
end $$;
