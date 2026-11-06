-- 009 · 제품 · 실적 : 관급 / 사급 제품 DB, 납품이력, 실적
--   * 보기: 본사(시스템 관리자 · 회사 관리자 · 본사 직원) — 현장 담당자는 안 보임
--   * 등록 · 수정: 시스템 관리자는 전부, 회사 관리자 · 본사 직원은 자기 회사 제품만
--   * 납품 금액 = TRUNC(수량 × 단가) — DB가 계산 (generated)
--   * 사진: space-files 버킷 product/{제품 id}/...

create or replace function gm.is_office() returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (select 1 from gm.profiles me where me.id = auth.uid() and me.active and me.role in ('system_admin', 'company_admin', 'staff'))
$$;
create or replace function gm.can_product(co uuid) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select exists (select 1 from gm.profiles me where me.id = auth.uid() and me.active and
    (me.role = 'system_admin' or (me.role in ('company_admin', 'staff') and me.company_id = co)))
$$;
grant execute on function gm.is_office(), gm.can_product(uuid) to authenticated, service_role;

create table gm.products (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references gm.companies(id),
  kind           text not null default '관급' check (kind in ('관급', '사급')),
  category       text,                         -- 분류 (교량받침 · 신축이음 · 보수재 …)
  name           text not null,
  spec           text,                         -- 규격
  unit           text not null default 'EA',
  price          bigint not null default 0 check (price >= 0),   -- 단가(원, 정수)
  maker          text,                         -- 제조사
  g2b_no         text,                         -- 물품식별번호
  contract_no    text,                         -- 조달 계약번호 (관급)
  contract_start date,
  contract_end   date,                         -- 조달 계약 만료일
  g2b_url        text,                         -- 조달청(나라장터 종합쇼핑몰) 페이지
  note           text,
  active         boolean not null default true,    -- 판매 중단이면 false (이력은 남김)
  created_by     uuid references gm.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on gm.products (company_id, kind, name);

create table gm.product_photos (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references gm.products(id) on delete cascade,
  storage_path text not null,
  thumb_path   text,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index on gm.product_photos (product_id, sort);

create table gm.deliveries (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references gm.products(id) on delete restrict,
  company_id    uuid not null references gm.companies(id),     -- 제품에서 자동
  kind          text not null,                                  -- 제품에서 자동 (그때의 관급/사급)
  delivered_on  date not null default current_date,
  project_id    uuid references gm.projects(id) on delete set null,  -- 우리 프로젝트면 연결
  project_name  text,                                           -- 공사명 (연결 안 된 외부 공사)
  client        text,                                           -- 수요기관 · 발주처
  contractor    text,                                           -- 시공사 · 계약상대자
  qty           numeric(14, 3) not null check (qty > 0),
  price         bigint not null check (price >= 0),
  amount        bigint generated always as (trunc(qty * price)::bigint) stored,
  note          text,
  created_by    uuid references gm.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on gm.deliveries (company_id, delivered_on desc);
create index on gm.deliveries (product_id, delivered_on desc);
create index on gm.deliveries (project_id);

-- 납품 회사 · 관급/사급은 제품에서 가져옴 (화면에서 바꿔 넣어도 무시), 연결된 프로젝트면 공사명 · 발주처 채움
create or replace function gm.delivery_fill() returns trigger
language plpgsql security definer set search_path = gm, public as $$
declare p gm.products; pr gm.projects;
begin
  select * into p from gm.products where id = new.product_id;
  new.company_id := p.company_id;
  if tg_op = 'INSERT' or new.product_id is distinct from old.product_id then new.kind := p.kind; end if;
  if new.project_id is not null then
    select * into pr from gm.projects where id = new.project_id;
    new.project_name := coalesce(nullif(new.project_name, ''), pr.name);
    new.client := coalesce(nullif(new.client, ''), pr.client);
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger delivery_fill before insert or update on gm.deliveries for each row execute function gm.delivery_fill();

create or replace function gm.touch_updated() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger products_touch before update on gm.products for each row execute function gm.touch_updated();

-- 제품별 누계 (RLS 그대로)
create view gm.v_product_stats with (security_invoker = true) as
  select product_id, count(*)::int n, sum(qty) qty, sum(amount)::bigint amount, max(delivered_on) last_on
  from gm.deliveries group by product_id;

alter table gm.products enable row level security;
alter table gm.product_photos enable row level security;
alter table gm.deliveries enable row level security;
create policy pd_read  on gm.products for select to authenticated using (gm.is_office());
create policy pd_write on gm.products for all to authenticated using (gm.can_product(company_id)) with check (gm.can_product(company_id));
create policy pp_read  on gm.product_photos for select to authenticated using (gm.is_office());
create policy pp_write on gm.product_photos for all to authenticated
  using (gm.can_product((select company_id from gm.products where id = product_id)))
  with check (gm.can_product((select company_id from gm.products where id = product_id)));
create policy dl_read  on gm.deliveries for select to authenticated using (gm.is_office());
create policy dl_write on gm.deliveries for all to authenticated
  using (gm.can_product(company_id))
  with check (gm.can_product((select company_id from gm.products where id = product_id)));

-- 사진 파일: product/{제품 id}/... — 그 제품을 고칠 수 있는 사람만 올리고 지움
create or replace function gm.can_product_file(path text) returns boolean
language sql stable security definer set search_path = gm, public as $$
  select split_part(path, '/', 1) = 'product'
     and gm.can_product((select company_id from gm.products where id::text = split_part(path, '/', 2)))
$$;
grant execute on function gm.can_product_file(text) to authenticated;
create policy "product_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'space-files' and gm.can_product_file(name));
create policy "product_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'space-files' and gm.can_product_file(name));

grant select, insert, update, delete on gm.products, gm.product_photos, gm.deliveries to authenticated;
grant select on gm.v_product_stats to authenticated;
grant all on gm.products, gm.product_photos, gm.deliveries to service_role;
grant select on gm.v_product_stats to service_role;
