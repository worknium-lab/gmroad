-- 012 · 워크니움 공지 (로그인 팝업)
--   * 공지는 WORKNIUM 라이선스 서버 관리 화면에서 쓰고, 관리 API(서비스 키)가 10분마다 받아 와 여기에 넣음
--   * 화면은 읽기만 함. 대상(회사 이름 · 역할)과 기간에 맞는 공지만 보임 — DB가 거름
--   * 누가 확인했는지는 기록하지 않음 (오늘 하루 보지 않기 · 확인했습니다는 각 기기에만 저장)

create table gm.vendor_notices (
  id                text primary key,                      -- 라이선스 서버의 공지 번호
  title             text not null,
  body              text not null default '',
  important         boolean not null default false,        -- 중요 공지 (빨간 표시)
  starts_at         timestamptz,                           -- 비면 바로
  ends_at           timestamptz,                           -- 비면 계속
  target_companies  text[] not null default '{}',          -- 회사 이름. 비면 모든 회사
  target_roles      gm.user_role[] not null default '{}',  -- 비면 모든 역할
  posted_at         timestamptz not null default now(),
  received_at       timestamptz not null default now()
);

alter table gm.vendor_notices enable row level security;
create policy vn_read on gm.vendor_notices for select to authenticated using (
  (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
  and (cardinality(target_roles) = 0 or (gm.me()).role = any (target_roles))
  and (cardinality(target_companies) = 0 or exists (
        select 1 from gm.companies c where c.id = (gm.me()).company_id and c.name = any (target_companies)))
);

grant select on gm.vendor_notices to authenticated;
grant all on gm.vendor_notices to service_role;
