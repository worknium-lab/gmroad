-- =====================================================================
-- ④ 내역서 5: 하도급내역서
--   업체마다: 하도급할 공종(엑셀 행) · 하도급율 · 원가 비목(원도급사 부담 비목 빼기) · 공급가액 끝수
--   금액은 화면이 적산 엔진으로 계산 (단가 × 하도급율 원 미만 버림 → 원가계산서), 확정할 때 결과를 result에 남김
--   업체는 이름으로 연결 (프로젝트 정보의 하도급사 목록은 저장할 때마다 다시 만들어져 id가 바뀜)
--   설계변경 확정 뒤에는 같은 업체에 seq를 올려 하도급 변경내역서를 새로 만듦 (seq 1 = 당초)
-- =====================================================================

create table gm.boq_subs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references gm.projects(id) on delete cascade,
  revision_id  uuid not null references gm.boq_revisions(id),     -- 기준 도급 · 준공내역서 (지우지 못하게 cascade 없음)
  vendor       text not null,
  seq          int not null default 1,
  title        text not null,
  rate         numeric(9,6) not null check (rate > 0 and rate <= 1),
  picks        jsonb not null default '[]',                        -- 하도급할 공종 · 항목 행 ["12", "30", …]
  exclude      jsonb not null default '[]',                        -- 뺀 원가 비목 키 ["ind", "emp", …]
  round        text not null default 'floor1000' check (round in ('floor1000', 'floor10000', 'ceil1000', 'none')),
  result       jsonb not null default '{}',                        -- 확정 때 금액 { target, sub, direct, ratio }
  note         text,
  status       text not null default 'draft' check (status in ('draft', 'confirmed')),
  created_by   uuid references gm.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  confirmed_by uuid references gm.profiles(id),
  confirmed_at timestamptz,
  unique (project_id, vendor, seq)
);
create index on gm.boq_subs (project_id, vendor, seq);

-- 같은 프로젝트 내역서인지 + 확정된 하도급내역서 보호 (관리자만 확정 취소)
create or replace function gm.protect_boq_sub() returns trigger
language plpgsql security definer set search_path = gm, public as $$
declare
  admin boolean := auth.uid() is null or exists (select 1 from gm.profiles me where me.id = auth.uid() and me.role in ('system_admin', 'company_admin'));
begin
  if tg_op = 'DELETE' then
    if old.status = 'confirmed' then raise exception '확정된 하도급내역서는 지울 수 없습니다'; end if;
    return old;
  end if;
  if not exists (select 1 from gm.boq_revisions r where r.id = new.revision_id and r.project_id = new.project_id) then
    raise exception '기준 내역서가 이 프로젝트 것이 아닙니다';
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    if not (admin and new.status = 'draft' and new.picks = old.picks and new.rate = old.rate and new.revision_id = old.revision_id) then
      raise exception '확정된 하도급내역서는 고칠 수 없습니다 (관리자가 확정을 취소한 뒤 고치세요)';
    end if;
    new.confirmed_by := null; new.confirmed_at := null;
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then
    new.confirmed_by := auth.uid(); new.confirmed_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_protect_sub before insert or update or delete on gm.boq_subs for each row execute function gm.protect_boq_sub();

alter table gm.boq_subs enable row level security;
create policy bsb_read on gm.boq_subs for select to authenticated using (gm.can_boq(project_id));
create policy bsb_write on gm.boq_subs for all to authenticated using (gm.can_boq_edit(project_id)) with check (gm.can_boq_edit(project_id));
grant select, insert, update, delete on gm.boq_subs to authenticated;
grant all on gm.boq_subs to service_role;
