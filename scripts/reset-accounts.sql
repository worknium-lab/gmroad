-- 계정 전부 지우기 (프로젝트 · 내역서 · 사진 등 자료는 그대로 둠)
--   GM 통합관리 계정(@gm.local)만 지움. 같은 수파베이스를 쓰는 다른 앱 계정은 건드리지 않음
--   자료에 남은 '작성자 · 확인자' 칸은 비워짐 (누가 했는지 이름만 사라짐)
begin;

-- 1) 자료에 걸린 작성자 · 확인자 연결을 비움 (트리거는 잠시 끔: 잠금 · 보호 규칙이 정리 작업을 막지 않게)
set local session_replication_role = replica;
do $$
declare r record;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, a.attname as col
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
    where k.contype = 'f' and k.confrelid = 'gm.profiles'::regclass and k.confdeltype <> 'c'
  loop
    execute format('update %I.%I set %I = null where %I is not null', r.sch, r.tbl, r.col, r.col);
  end loop;
end $$;
set local session_replication_role = origin;

-- 2) 계정 지우기 → 인사정보 · 프로젝트 참여 · 알림 · 알림 받는 기기는 함께 지워짐
delete from auth.users where email like '%@gm.local';

commit;

select count(*) as "남은 GM 계정 수" from gm.profiles;
