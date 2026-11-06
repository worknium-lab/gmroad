-- =====================================================================
-- 회사 공용공간: 게시판(공지 · 전달, 필독 확인) · 자료실(버전 · 외부 공유) · 회사 일정 · 사내 연락처
-- + 인사정보 보호: 주소 · 휴대폰 · 사번 · 입사일은 본인 · 관리자만 (연락처는 공개한 휴대폰만)
-- =====================================================================

-- 공용공간에 글 · 자료 · 일정을 올릴 수 있는가 (관리자 · 본사 직원)
create or replace function gm.can_write_space() returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (select 1 from gm.profiles me where me.id = auth.uid() and me.active and me.role in ('system_admin', 'company_admin', 'staff'))
$$;
grant execute on function gm.can_write_space() to authenticated, service_role;

-- 이 글의 대상인가 (대상 회사가 비어 있으면 전체)
create or replace function gm.in_target(targets uuid[]) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select coalesce(cardinality(targets), 0) = 0 or gm.is_sysadmin()
      or exists (select 1 from gm.profiles me where me.id = auth.uid() and me.company_id = any(targets))
$$;
grant execute on function gm.in_target(uuid[]) to authenticated, service_role;

-- ---------- 게시판 ----------
create table gm.posts (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'notice' check (kind in ('notice', 'memo')),   -- 공지사항 / 전달사항
  title            text not null,
  body             text not null default '',
  target_companies uuid[] not null default '{}',
  must_read        boolean not null default false,
  pinned           boolean not null default false,
  allow_comments   boolean not null default true,
  publish_at       timestamptz not null default now(),          -- 예약 게시
  event_date       date,                                         -- 날짜를 넣으면 회사 일정에도 올라감
  event_end        date,
  attachments      jsonb not null default '[]',                  -- [{ path, name, size }]
  notified         boolean not null default false,               -- 게시 알림 보냄
  author_id        uuid references gm.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on gm.posts (publish_at desc);

create table gm.post_reads (
  post_id      uuid not null references gm.posts(id) on delete cascade,
  user_id      uuid not null references gm.profiles(id) on delete cascade,
  read_at      timestamptz not null default now(),
  confirmed_at timestamptz,                                      -- 필독 '확인했습니다'
  primary key (post_id, user_id)
);

create table gm.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references gm.posts(id) on delete cascade,
  author_id  uuid references gm.profiles(id) default auth.uid(),
  body       text not null,
  created_at timestamptz not null default now()
);
create index on gm.post_comments (post_id, created_at);

create or replace function gm.post_visible(p uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (select 1 from gm.posts x where x.id = p and gm.in_target(x.target_companies)
                 and (x.publish_at <= now() or x.author_id = auth.uid() or gm.is_admin()))
$$;
grant execute on function gm.post_visible(uuid) to authenticated, service_role;

alter table gm.posts enable row level security;
alter table gm.post_reads enable row level security;
alter table gm.post_comments enable row level security;
create policy ps_read on gm.posts for select to authenticated
  using (gm.in_target(target_companies) and (publish_at <= now() or author_id = auth.uid() or gm.is_admin()));
create policy ps_insert on gm.posts for insert to authenticated with check (gm.can_write_space() and author_id = auth.uid());
create policy ps_update on gm.posts for update to authenticated using (author_id = auth.uid() or gm.is_admin()) with check (author_id = auth.uid() or gm.is_admin());
create policy ps_delete on gm.posts for delete to authenticated using (author_id = auth.uid() or gm.is_admin());

create policy pr_read on gm.post_reads for select to authenticated
  using (user_id = auth.uid() or gm.is_admin() or exists (select 1 from gm.posts x where x.id = post_id and x.author_id = auth.uid()));
create policy pr_write on gm.post_reads for insert to authenticated with check (user_id = auth.uid() and gm.post_visible(post_id));
create policy pr_update on gm.post_reads for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy pc_read on gm.post_comments for select to authenticated using (gm.post_visible(post_id));
create policy pc_insert on gm.post_comments for insert to authenticated
  with check (author_id = auth.uid() and gm.post_visible(post_id) and exists (select 1 from gm.posts x where x.id = post_id and x.allow_comments));
create policy pc_delete on gm.post_comments for delete to authenticated using (author_id = auth.uid() or gm.is_admin());

-- ---------- 자료실 ----------
create table gm.library_files (
  id          uuid primary key default gen_random_uuid(),
  folder      text not null check (folder in ('홍보자료', '카탈로그', '기술자료', '양식함')),
  subfolder   text,                                              -- 회사소개서 · 시험성적서 · 시공사례 …
  title       text not null,                                     -- 같은 폴더 · 같은 이름이면 새 버전
  company_id  uuid references gm.companies(id),                  -- 비우면 공통
  visibility  text not null default 'internal' check (visibility in ('internal', 'external')),  -- 사내 전용 / 외부 공유 가능
  version     int not null default 1,
  is_latest   boolean not null default true,
  path        text not null,
  file_name   text not null,
  size_bytes  bigint,
  mime        text,
  note        text,
  uploaded_by uuid references gm.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on gm.library_files (folder, title, version desc);

-- 같은 이름을 올리면 새 버전, 이전 것은 '이전 버전'
create or replace function gm.library_version() returns trigger
language plpgsql security definer set search_path = gm, public as $$
declare v int;
begin
  select coalesce(max(version), 0) into v from gm.library_files where folder = new.folder and lower(title) = lower(new.title) and coalesce(company_id::text, '') = coalesce(new.company_id::text, '');
  new.version := v + 1; new.is_latest := true;
  update gm.library_files set is_latest = false where folder = new.folder and lower(title) = lower(new.title) and coalesce(company_id::text, '') = coalesce(new.company_id::text, '') and is_latest;
  return new;
end $$;
create trigger trg_library_version before insert on gm.library_files for each row execute function gm.library_version();

create table gm.share_links (
  id            uuid primary key default gen_random_uuid(),
  file_id       uuid not null references gm.library_files(id) on delete cascade,
  token         text not null unique,
  expires_at    timestamptz not null,
  max_downloads int,                                             -- 1이면 한 번만
  downloads     int not null default 0,
  revoked       boolean not null default false,
  note          text,                                            -- 누구에게 보냈는지
  created_by    uuid references gm.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

alter table gm.library_files enable row level security;
alter table gm.share_links enable row level security;
create policy lf_read on gm.library_files for select to authenticated using (true);
create policy lf_insert on gm.library_files for insert to authenticated with check (gm.can_write_space());
create policy lf_update on gm.library_files for update to authenticated using (uploaded_by = auth.uid() or gm.is_admin()) with check (uploaded_by = auth.uid() or gm.is_admin());
create policy lf_delete on gm.library_files for delete to authenticated using (uploaded_by = auth.uid() or gm.is_admin());
create policy sl_read on gm.share_links for select to authenticated using (gm.can_write_space());
create policy sl_insert on gm.share_links for insert to authenticated
  with check (gm.can_write_space() and exists (select 1 from gm.library_files f where f.id = file_id and f.visibility = 'external'));
create policy sl_update on gm.share_links for update to authenticated using (created_by = auth.uid() or gm.is_admin()) with check (created_by = auth.uid() or gm.is_admin());

-- ---------- 회사 일정 ----------
create table gm.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  starts_on   date not null,
  ends_on     date,
  time_text   text,                                              -- '10:00' 등
  category    text not null default '전사' check (category in ('전사', '교육', '현장', '마감', '회사')),
  company_id  uuid references gm.companies(id),                  -- 회사별 일정이면
  project_id  uuid references gm.projects(id) on delete set null,
  post_id     uuid references gm.posts(id) on delete cascade,    -- 공지에서 온 일정
  place       text,
  note        text,
  created_by  uuid references gm.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on gm.events (starts_on);
alter table gm.events enable row level security;
create policy ev_read on gm.events for select to authenticated
  using (post_id is null or gm.post_visible(post_id));
create policy ev_insert on gm.events for insert to authenticated with check (gm.can_write_space());
create policy ev_update on gm.events for update to authenticated using (created_by = auth.uid() or gm.is_admin()) with check (created_by = auth.uid() or gm.is_admin());
create policy ev_delete on gm.events for delete to authenticated using (created_by = auth.uid() or gm.is_admin());

-- 공지에 날짜를 넣으면 회사 일정에도 (고치면 같이 고쳐짐)
create or replace function gm.sync_post_event() returns trigger
language plpgsql security definer set search_path = gm, public as $$
begin
  delete from gm.events where post_id = new.id;
  if new.event_date is not null then
    insert into gm.events (title, starts_on, ends_on, category, company_id, post_id, created_by)
    values (new.title, new.event_date, new.event_end,
            case when coalesce(cardinality(new.target_companies), 0) = 1 then '회사' else '전사' end,
            case when coalesce(cardinality(new.target_companies), 0) = 1 then new.target_companies[1] end, new.id, new.author_id);
  end if;
  return new;
end $$;
create trigger trg_sync_post_event after insert or update of title, event_date, event_end, target_companies on gm.posts
  for each row execute function gm.sync_post_event();

-- ---------- 사내 연락처 ----------
-- 휴대폰은 본인이 공개로 둔 경우만, 주소 · 사번 · 입사일은 빼고
create or replace view gm.v_directory as
  select p.id, p.name, p.username, p.company_id, c.name as company_name, p.dept, p.rank, p.position, p.email, p.role,
         case when p.phone_public then p.phone end as phone
  from gm.profiles p left join gm.companies c on c.id = p.company_id
  where p.active;
grant select on gm.v_directory to authenticated;

-- ---------- 인사정보 보호 ----------
-- 지금까지는 로그인한 누구나 다른 사람의 주소 · 휴대폰을 읽을 수 있었음 → 본인 · 관리자만
revoke select on gm.profiles from authenticated;
grant select (id, username, name, company_id, role, dept, rank, position, phone_public, email, must_change_password, active, created_at) on gm.profiles to authenticated;

create or replace function gm.my_profile() returns setof gm.profiles
language sql stable security definer set search_path = gm, public as $$ select * from gm.profiles where id = auth.uid() $$;
create or replace function gm.admin_profiles() returns setof gm.profiles
language sql stable security definer set search_path = gm, public as $$
  select p.* from gm.profiles p where gm.is_sysadmin() or (gm.is_admin() and p.company_id = (gm.me()).company_id) order by p.created_at
$$;
grant execute on function gm.my_profile(), gm.admin_profiles() to authenticated;

-- ---------- 파일 (space-files 버킷: 게시판 첨부 · 자료실) ----------
-- 경로: {board|library}/{올린 사람 id}/{파일}
insert into storage.buckets (id, name, public) values ('space-files', 'space-files', false) on conflict (id) do nothing;
create policy "space_read" on storage.objects for select to authenticated using (bucket_id = 'space-files');
create policy "space_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'space-files' and gm.can_write_space() and (storage.foldername(name))[2] = auth.uid()::text);
create policy "space_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'space-files' and ((storage.foldername(name))[2] = auth.uid()::text or gm.is_admin()));

grant select, insert, update, delete on gm.posts, gm.post_reads, gm.post_comments, gm.library_files, gm.share_links, gm.events to authenticated;
grant all on gm.posts, gm.post_reads, gm.post_comments, gm.library_files, gm.share_links, gm.events to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table gm.posts, gm.post_comments;
  end if;
end $$;
