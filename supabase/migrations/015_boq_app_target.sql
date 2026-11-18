-- =====================================================================
-- ④ 내역서 6: 현장 앱으로 내역서 보내기 (공릉천교 현장 앱 '내역' 탭, 보기 전용)
--   어느 지엠로드 프로젝트가 어느 현장 앱과 이어지는지. 시스템 관리자만 잇고 끊음
--   보내기는 관리 API가 service role로 현장 앱의 문서 표(public.docs, col='boq', id=doc_id)에 씀
--   → 현장 앱은 원래 동기화로 받아 기기에 저장 (인터넷 없어도 보기)
-- =====================================================================

create table gm.boq_app_targets (
  project_id   uuid primary key references gm.projects(id) on delete cascade,
  app          text not null default 'gongneung' check (app in ('gongneung')),
  doc_id       text not null default 'current',
  sent_at      timestamptz,
  sent_title   text,
  sent_by      uuid references gm.profiles(id),
  updated_by   uuid references gm.profiles(id) default auth.uid(),
  updated_at   timestamptz not null default now(),
  unique (app, doc_id)                                  -- 한 앱 문서에는 한 프로젝트만
);

alter table gm.boq_app_targets enable row level security;
create policy bat_read on gm.boq_app_targets for select to authenticated using (gm.can_boq(project_id));
create policy bat_write on gm.boq_app_targets for all to authenticated using (gm.is_sysadmin()) with check (gm.is_sysadmin());
grant select, insert, update, delete on gm.boq_app_targets to authenticated;
grant all on gm.boq_app_targets to service_role;
