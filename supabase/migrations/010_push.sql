-- 010 · 앱 푸시 (Web Push) : 폰 · PC 잠금화면 알림
--   * 알림(gm.notifications)이 생기면 API가 몇 초 안에 그 사람의 기기들로 보냄
--   * 기기 등록은 본인만 (같은 폰을 다른 사람이 로그인하면 그 사람으로 넘어감)
--   * 푸시 키(VAPID)는 API가 처음 켜질 때 만들어 여기 보관 — 서비스 키로만 읽음

create table gm.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references gm.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  ua          text,                         -- 기기 이름 (브라우저 정보)
  fail_count  int not null default 0,
  last_ok_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index on gm.push_subscriptions (user_id);

create table gm.push_prefs (
  user_id     uuid primary key references gm.profiles(id) on delete cascade,
  quiet_night boolean not null default false,   -- 밤 10시 ~ 아침 7시에는 보내지 않음
  updated_at  timestamptz not null default now()
);

create table gm.push_keys (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);

alter table gm.notifications add column if not exists pushed_at timestamptz;
update gm.notifications set pushed_at = now() where pushed_at is null;   -- 지금까지 쌓인 알림은 보내지 않음
create index if not exists notifications_unpushed on gm.notifications (created_at) where pushed_at is null;

alter table gm.push_subscriptions enable row level security;
alter table gm.push_prefs enable row level security;
alter table gm.push_keys enable row level security;   -- 정책 없음 = 서비스 키만
create policy ps_own on gm.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy pf_own on gm.push_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 이 기기를 지금 로그인한 사람 것으로 등록 (다른 사람 이름으로 등록돼 있었으면 넘겨받음)
create or replace function gm.push_register(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = gm, public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  insert into gm.push_subscriptions (user_id, endpoint, p256dh, auth, ua)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fail_count = 0;
end $$;

grant select, insert, update, delete on gm.push_subscriptions, gm.push_prefs to authenticated;
grant execute on function gm.push_register(text, text, text, text) to authenticated;
grant all on gm.push_subscriptions, gm.push_prefs, gm.push_keys to service_role;
revoke all on gm.push_keys from authenticated, anon;
