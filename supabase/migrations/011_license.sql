-- 011 · 라이선스 잠금 (DB 쪽)
--   * 사용 단계는 DB가 날짜로 직접 계산 → 프로그램(API)이 멈춰도 시간이 지나면 자동으로 잠김
--     정상 → 미입금 알림(만료 달 10일 이후) → 유예(만료 후 1~7일) → 읽기 전용(8~38일 + 백업 연장) → 차단
--   * 읽기 전용 · 차단이면 gm 스키마의 모든 테이블과 파일 저장소에 쓰기가 막힘 (트리거)
--     새로 만드는 테이블에도 자동으로 붙음 (이벤트 트리거)
--   * 라이선스 값은 서명 검증을 거친 API(서비스 키)만 바꿈. 화면 · 일반 계정은 못 바꿈
--   * 서버 시계를 되돌려도 지금까지 본 가장 늦은 시각을 기준으로 계산

create table gm.license_state (
  id              int primary key default 1 check (id = 1),
  install_id      uuid not null default gen_random_uuid(),   -- 이 설치본 고유 번호
  customer_id     text,
  customer_name   text,
  paid_until      date not null default (current_date + 60),  -- 사용 기한 (선불한 달의 말일). 처음 설치 후 60일은 설정 기간
  readonly_extra  int  not null default 0,                    -- 백업 기간 연장 일수 (1일 10만 원)
  tampered        boolean not null default false,             -- 위변조 감지 → 즉시 읽기 전용
  tamper_note     text,
  token           text,                                       -- 라이선스 서버가 서명한 원본 (API가 주기적으로 대조)
  pubkey          text,                                       -- 개발판에서만 사용 (배포판은 프로그램에 박혀 있음)
  max_seen_at     timestamptz not null default now(),         -- 시계 되돌리기 방지
  last_check_at   timestamptz,
  last_check_ok   boolean,
  last_error      text,
  updated_at      timestamptz not null default now()
);
insert into gm.license_state (id) values (1) on conflict do nothing;

-- 지금 기준 시각 (시계를 되돌려도 뒤로 가지 않음)
create or replace function gm.license_now() returns timestamptz
language sql stable security definer set search_path = gm, public as $$
  select greatest(now(), coalesce((select max_seen_at from gm.license_state where id = 1), now()))
$$;

-- 사용 단계: normal / notice / grace / readonly / blocked
create or replace function gm.license_mode() returns text
language plpgsql stable security definer set search_path = gm, public as $$
declare s gm.license_state; today date; d int;
begin
  select * into s from gm.license_state where id = 1;
  if not found then return 'blocked'; end if;                  -- 라이선스 행을 지우면 차단
  if s.tampered then return 'readonly'; end if;
  today := (gm.license_now() at time zone 'Asia/Seoul')::date;
  d := today - s.paid_until;                                     -- 만료 후 지난 날 수
  if d <= 0 then
    -- 만료 달의 10일이 지났는데 다음 달 입금이 안 됐으면 알림
    if date_trunc('month', today) = date_trunc('month', s.paid_until) and extract(day from today) > 10 then return 'notice'; end if;
    return 'normal';
  end if;
  if d <= 7 then return 'grace'; end if;
  if d <= 38 + s.readonly_extra then return 'readonly'; end if;
  return 'blocked';
end $$;

-- 화면용 요약 (누구나 읽음 — 비밀 값은 없음)
create or replace function gm.license_info() returns json
language sql stable security definer set search_path = gm, public as $$
  select json_build_object(
    'mode', gm.license_mode(), 'paid_until', s.paid_until, 'customer_name', s.customer_name,
    'readonly_extra', s.readonly_extra, 'tampered', s.tampered,
    'grace_end', s.paid_until + 7, 'readonly_end', s.paid_until + 38 + s.readonly_extra,
    'last_check_at', s.last_check_at, 'last_check_ok', s.last_check_ok, 'install_id', s.install_id,
    'today', (gm.license_now() at time zone 'Asia/Seoul')::date)
  from gm.license_state s where id = 1
$$;

-- 쓰기 막기: 읽기 전용 · 차단이면 예외 (알림 · 푸시 · 기록 · 계정은 허용)
--   화면(로그인한 사용자)에서 오는 쓰기는 모두 막음. 관리 API(서비스 키)는 내려받기 등 허용된 일만 하도록 API가 직접 막음
--   (security definer가 아니어야 current_user가 실제 요청한 역할)
create or replace function gm.license_guard() returns trigger
language plpgsql set search_path = gm, public as $$
declare m text;
begin
  if current_user = 'service_role' then return coalesce(new, old); end if;
  m := gm.license_mode();
  if m in ('readonly', 'blocked') then
    raise exception using errcode = 'P0403',
      message = case when m = 'blocked' then '라이선스 사용 기간이 끝나 사용이 중지되었습니다. 관리자에게 문의하세요.'
                     else '라이선스 읽기 전용 기간입니다. 보기 · 내려받기만 할 수 있습니다. 관리자에게 문의하세요.' end;
  end if;
  return coalesce(new, old);
end $$;

create or replace function gm.license_guard_all() returns int
language plpgsql security definer set search_path = gm, public as $$
declare t record; n int := 0;
begin
  for t in
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'gm' and c.relkind in ('r', 'p')
      and c.relname not in ('license_state', 'notifications', 'push_subscriptions', 'push_prefs', 'push_keys', 'activity_log', 'profiles')
      and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'license_guard')
  loop
    execute format('create trigger license_guard before insert or update or delete on gm.%I for each statement execute function gm.license_guard()', t.relname);
    n := n + 1;
  end loop;
  return n;
end $$;
select gm.license_guard_all();

-- 앞으로 gm에 새 테이블을 만들면 자동으로 잠금을 붙임
create or replace function gm.license_ddl_hook() returns event_trigger
language plpgsql as $$
begin
  if exists (select 1 from pg_event_trigger_ddl_commands() where schema_name = 'gm' and command_tag = 'CREATE TABLE') then
    perform gm.license_guard_all();
  end if;
end $$;
drop event trigger if exists gm_license_ddl;
create event trigger gm_license_ddl on ddl_command_end when tag in ('CREATE TABLE') execute function gm.license_ddl_hook();

-- 파일 올리기 · 지우기도 막음 (우리 버킷만)
create or replace function gm.license_guard_files() returns trigger
language plpgsql set search_path = gm, public as $$
begin
  if current_user = 'service_role' then return coalesce(new, old); end if;
  if coalesce(new.bucket_id, old.bucket_id) in ('project-files', 'space-files') and gm.license_mode() in ('readonly', 'blocked') then
    raise exception using errcode = 'P0403', message = '라이선스 읽기 전용 기간에는 파일을 올리거나 지울 수 없습니다.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists gm_license_files on storage.objects;
create trigger gm_license_files before insert or update or delete on storage.objects for each row execute function gm.license_guard_files();

-- 권한: 라이선스 행은 서비스 키(API)만. 화면은 license_info()로만 봄
alter table gm.license_state enable row level security;
revoke all on gm.license_state from authenticated, anon;
grant all on gm.license_state to service_role;
grant execute on function gm.license_info(), gm.license_mode() to authenticated, anon, service_role;
