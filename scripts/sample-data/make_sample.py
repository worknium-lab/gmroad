#!/usr/bin/env python3
"""앱 화면 확인용 샘플 프로젝트 SQL 만들기 → sample.sql / remove.sql

  python3 scripts/sample-data/make_sample.py
  서버: docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1 < scripts/sample-data/sample.sql
  지우기: docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1 < scripts/sample-data/remove.sql

- 프로젝트 이름 · 제품 이름 앞에 [샘플] 이 붙음. 같은 ID로 만들기 때문에 다시 넣으면 먼저 지우고 넣음
- 사진 · 문서 파일(저장소 파일이 필요한 것)은 넣지 않음
- 샘플이 만든 알림은 '이미 보냄'으로 표시해서 폰 푸시가 가지 않음
"""
import datetime as dt
import json
import os
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
NS = uuid.UUID('5a3b1e8c-6d2f-4b7a-9c1e-0f2a3b4c5d6e')
def uid(key): return str(uuid.uuid5(NS, key))
def q(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, tuple): return "array[" + ', '.join(q(x) for x in v) + "]::text[]"   # text[] 칸
    if isinstance(v, (dict, list)): return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"
def ins(table, rows):
    if not rows: return ''
    cols = list(rows[0].keys())
    vals = ',\n'.join('(' + ', '.join(q(r[c]) for c in cols) + ')' for r in rows)
    return f'insert into gm.{table} ({", ".join(cols)}) values\n{vals};\n'
def ts(d, hm): return f'{d.isoformat()} {hm}:00+09'

# 실제 계정 · 회사 (홈 서버 지엠로드 DB)
ADMIN = '1093d353-5808-4ce2-9464-2d79d1e1981c'   # gmconst (system_admin)
STAFF = '7e14a402-f1d2-4cd0-b7ba-a6c28432955b'   # gmroad  (company_admin)
GMROAD = 'c21e0d31-8242-44d2-b3a2-3b58cd503b44'  # 지엠로드
TODAY = dt.date(2026, 11, 18)

P = uid('project')
out = []

# ── 프로젝트 ──
out.append(ins('projects', [dict(id=P, company_id=GMROAD, name='[샘플] 2026년 한빛교 내진보강공사',
    client='충청북도 도로관리사업소', prime_contractor='(주)대한종합건설', prime_amount=2846500000,
    start_date='2026-09-01', end_date='2027-04-30', patent_method='QRA 내진변위 제한장치', status='active',
    memo='앱 화면 확인용 샘플 데이터입니다. 지워도 됩니다 (scripts/sample-data/remove.sql).', created_by=ADMIN)]))
out.append(ins('project_subcontracts', [
    dict(id=uid('sub1'), project_id=P, name='지엠로드', amount=1248000000, is_patent=True, sort=0),
    dict(id=uid('sub2'), project_id=P, name='(주)한결토건', amount=386000000, is_patent=False, sort=1)]))
out.append(ins('project_members', [
    dict(project_id=P, user_id=ADMIN, can_boq=True, can_labor=True, can_field=True),
    dict(project_id=P, user_id=STAFF, can_boq=True, can_labor=True, can_field=True)]))

# ── 공사 구성: 시설물 › 위치 › 공종 ──
F1, F2 = uid('fac-bridge'), uid('fac-common')
out.append(ins('facilities', [dict(id=F1, project_id=P, name='한빛교', kind='교량', sort=0),
                              dict(id=F2, project_id=P, name='공통', kind='공통', sort=1)]))
LOCS = ['A1', 'P1', 'P2', 'P3', 'A2']
L = {n: uid('loc-' + n) for n in LOCS}; L['전구간'] = uid('loc-all')
out.append(ins('locations', [dict(id=L[n], facility_id=F1, name=n, sort=i) for i, n in enumerate(LOCS)]
               + [dict(id=L['전구간'], facility_id=F2, name='전구간', sort=0)]))
WORK = [  # 키, 공종, 규격, 단위, 도급단가
    ('bearing', '교량받침 교체', '탄성받침 2,000kN', 'EA', 6850000),
    ('qra', '내진변위 제한장치 설치', 'QRA-500', 'EA', 4320000),
    ('joint', '신축이음장치 교체', '레일형 80mm', 'm', 1180000),
    ('patch', '단면보수', '폴리머 모르타르 t=50mm', 'm2', 186000),
    ('crack', '균열보수', '저압 주입공법', 'm', 42500),
    ('coat', '표면보호 도장', '콘크리트 표면보호재', 'm2', 38700),
    ('scaf', '교좌 가설 작업대', '강재 브라켓식', '개소', 2450000),
    ('traffic', '교통관리', '신호수 · 안전시설', '식', 48000000),
]
W = {k: uid('work-' + k) for k, *_ in WORK}
out.append(ins('work_items', [dict(id=W[k], project_id=P, name=n, spec=s, unit=u, unit_price=pr, sort=i)
                              for i, (k, n, s, u, pr) in enumerate(WORK)]))
DESIGN = {}
for n in LOCS:
    abut = n.startswith('A')
    DESIGN[(n, 'bearing')] = 4 if abut else 6
    DESIGN[(n, 'qra')] = 2 if abut else 4
    if abut: DESIGN[(n, 'joint')] = 12.6
    DESIGN[(n, 'patch')] = 18.5 if abut else 24.0
    DESIGN[(n, 'crack')] = 36 if abut else 48
    DESIGN[(n, 'coat')] = 120 if abut else 210
    DESIGN[(n, 'scaf')] = 1
DESIGN[('전구간', 'traffic')] = 1
out.append(ins('location_work', [dict(location_id=L[l], work_item_id=W[w], design_qty=v) for (l, w), v in DESIGN.items()]))

# ── 작업일보 (10/12 ~ 11/18, 일요일 제외) ──
days = []
d = dt.date(2026, 10, 12)
while d <= TODAY:
    if d.weekday() != 6: days.append(d)
    d += dt.timedelta(days=1)
WEATHER = ['맑음', '맑음', '구름 많음', '맑음', '흐림', '맑음', '비 (오전)', '맑음', '구름 조금']
reports, crews, equip, entries = [], [], [], []
done = {}  # 누계 (설계수량 넘지 않게)
def add(rid, d, loc, w, qty, status):
    left = DESIGN[(loc, w)] - done.get((loc, w), 0)
    qty = round(min(qty, left), 3)
    if qty <= 0: return
    done[(loc, w)] = done.get((loc, w), 0) + qty
    entries.append(dict(id=uid(f'pe-{d}-{loc}-{w}'), report_id=rid, project_id=P, location_id=L[loc], work_item_id=W[w],
        qty=qty, status=status, note=None, entered_by=STAFF,
        reviewed_by=ADMIN if status == 'approved' else None,
        reviewed_at=ts(d + dt.timedelta(days=1), '09:20') if status == 'approved' else None))
for i, d in enumerate(days):
    rid = uid(f'rep-{d}')
    if d == TODAY: st = 'draft'
    elif d >= dt.date(2026, 11, 14): st = 'submitted'
    else: st = 'confirmed'
    es = 'approved' if st == 'confirmed' else 'pending'
    rain = WEATHER[i % len(WEATHER)].startswith('비')
    if d <= dt.date(2026, 10, 24):
        phase = 'scaf'
        note = '교좌 가설 작업대 설치, 교통 통제 (1차로 부분 차단)'
    elif d <= dt.date(2026, 11, 7):
        phase = 'repair'
        note = '교대 · 교각 단면보수 및 균열 주입, 열화부 치핑'
    else:
        phase = 'bearing'
        note = '기존 받침 철거 · 탄성받침 교체, 내진변위 제한장치 앵커 천공 및 설치'
    if rain: note += ' / 오전 우천으로 작업 일부 중지'
    if d == TODAY: note = '(작성 중) ' + note
    reports.append(dict(id=rid, project_id=P, report_date=d.isoformat(), status=st, weather=WEATHER[i % len(WEATHER)], work_note=note,
        submitted_by=STAFF if st != 'draft' else None, submitted_at=ts(d, '18:10') if st != 'draft' else None,
        confirmed_by=ADMIN if st == 'confirmed' else None,
        confirmed_at=ts(d + dt.timedelta(days=1), '09:20') if st == 'confirmed' else None, return_reason=None,
        created_at=ts(d, '07:30')))
    crew = [('작업반장', '지엠로드', 1), ('특별인부', '지엠로드', 3 if phase == 'bearing' else 2), ('보통인부', '(주)한결토건', 4),
            ('신호수', '(주)한결토건', 2)]
    if phase == 'scaf': crew.append(('비계공', '(주)한결토건', 3)); crew.append(('용접공', '지엠로드', 1))
    if phase == 'repair': crew.append(('미장공', '(주)한결토건', 3))
    if phase == 'bearing': crew.append(('기계설치공', '지엠로드', 2)); crew.append(('용접공', '지엠로드', 1))
    for j, (t, c, h) in enumerate(crew):
        crews.append(dict(id=uid(f'crew-{d}-{j}'), report_id=rid, trade=t, company=c, headcount=h - (1 if rain and h > 2 else 0), sort=j))
    eq = [('고소작업차', '18m', '임대', '8시간', '한빛중기', 450000)]
    if phase in ('scaf', 'bearing'): eq.append(('카고크레인', '25톤', '임대', '6시간', '충북크레인', 780000))
    if phase == 'bearing': eq.append(('유압잭', '200톤 × 4대', '직영', '종일', None, 0))
    if phase == 'repair': eq.append(('발전기', '50kW', '직영', '종일', None, 0)); eq.append(('고압 세척기', '200bar', '직영', '4시간', None, 0))
    for j, (n, s, k, h, v, a) in enumerate(eq):
        equip.append(dict(id=uid(f'eq-{d}-{j}'), report_id=rid, name=n, spec=s, kind=k, hours=h, vendor=v, amount=a, doc_path=None, sort=j))
    if d == TODAY: continue
    add(rid, d, '전구간', 'traffic', 0.02, es)
    k = 0.5 if rain else 1
    if phase == 'scaf':
        n = LOCS[min(i // 2, 4)]
        if i % 2 == 1: add(rid, d, n, 'scaf', 1, es)
    elif phase == 'repair':
        for n in ['A1', 'P1', 'P2']:
            add(rid, d, n, 'patch', 2.5 * k, es)
            add(rid, d, n, 'crack', 6 * k, es)
    else:
        for n in ['A1', 'P1']:
            add(rid, d, n, 'bearing', 1 * k, es)
            if i % 2 == 0: add(rid, d, n, 'qra', 1, es)
out.append(ins('daily_reports', reports))
out.append(ins('daily_crews', crews))
out.append(ins('daily_equipment', equip))
out.append(ins('progress_entries', entries))

# ── 자재 · 수불 ──
MATS = [('bearing', '탄성받침', '2,000kN (GM-EB 2000)', 'EA', 26), ('qra', '내진변위 제한장치', 'QRA-500', 'EA', 16),
        ('mortar', '폴리머 모르타르', '25kg/포', '포', 420), ('epoxy', '에폭시 주입제', '저점도 2액형', 'kg', 150),
        ('coat', '표면보호재', '수성 침투형', 'L', 600)]
M = {k: uid('mat-' + k) for k, *_ in MATS}
out.append(ins('materials', [dict(id=M[k], project_id=P, name=n, spec=s, unit=u, design_qty=dq, sort=i)
                             for i, (k, n, s, u, dq) in enumerate(MATS)]))
moves = []
def mv(key, date, kind, qty, vendor=None):
    moves.append(dict(id=uid(f'mv-{key}-{date}-{kind}'), project_id=P, material_id=M[key], report_id=uid(f'rep-{date}'),
                      move_date=date, kind=kind, qty=qty, vendor=vendor, photo_path=None, invoice_path=None, entered_by=STAFF))
mv('mortar', '2026-10-24', 'in', 160, '(주)한국건자재'); mv('epoxy', '2026-10-24', 'in', 60, '(주)한국건자재')
mv('mortar', '2026-11-02', 'in', 120, '(주)한국건자재')
for dd, mq, eq_ in [('2026-10-27', 18, 6), ('2026-10-29', 22, 7), ('2026-10-31', 20, 6), ('2026-11-03', 24, 8), ('2026-11-05', 21, 7), ('2026-11-07', 19, 6)]:
    mv('mortar', dd, 'use', mq); mv('epoxy', dd, 'use', eq_)
mv('bearing', '2026-11-06', 'in', 12, '지엠로드 음성공장'); mv('qra', '2026-11-06', 'in', 8, '지엠로드 음성공장')
for dd, bq in [('2026-11-10', 2), ('2026-11-12', 2), ('2026-11-14', 2), ('2026-11-17', 2)]:
    mv('bearing', dd, 'use', bq); mv('qra', dd, 'use', 1)
out.append(ins('material_moves', moves))

# ── 자료요청 ──
out.append(ins('requests', [
    dict(id=uid('rq1'), project_id=P, kind='사진', title='P1 받침 철거 전 · 후 사진', body='감리단 제출용. 철거 전 · 철거 후 · 받침면 정리 후 각 2장 이상',
         location_id=L['P1'], due_at=ts(dt.date(2026, 11, 12), '18:00'), remind=True, from_user=ADMIN, to_user=STAFF, status='done',
         answer_note='현장 앱으로 12장 올렸습니다', answered_at=ts(dt.date(2026, 11, 12), '16:40'), created_at=ts(dt.date(2026, 11, 10), '10:05')),
    dict(id=uid('rq2'), project_id=P, kind='수량 확인', title='A1 단면보수 실측 면적 확인', body='설계 18.5㎡ 대비 실측 증가 여부 확인 (변경 검토용)',
         location_id=L['A1'], due_at=ts(dt.date(2026, 11, 21), '18:00'), remind=True, from_user=ADMIN, to_user=STAFF, status='in_progress',
         answer_note=None, answered_at=None, created_at=ts(dt.date(2026, 11, 13), '14:20')),
    dict(id=uid('rq3'), project_id=P, kind='송장·계산서', title='탄성받침 2차 반입 송장', body='11/20 반입분 송장 · 시험성적서 사진',
         location_id=None, due_at=ts(dt.date(2026, 11, 20), '18:00'), remind=True, from_user=ADMIN, to_user=STAFF, status='open',
         answer_note=None, answered_at=None, created_at=ts(dt.date(2026, 11, 17), '09:10')),
]))

# ── 회의록 ──
MT1, MT2 = uid('meet1'), uid('meet2')
out.append(ins('meetings', [
    dict(id=MT1, project_id=P, title='10월 공정 정례회의', held_at=ts(dt.date(2026, 10, 30), '14:00'), kind='정례', place='현장사무소 회의실',
         attendees=[{'name': '김도현', 'org': '충청북도 도로관리사업소'}, {'name': '이정훈', 'org': '(주)대한종합건설'}, {'name': '박성민', 'org': '○○감리단'}, {'name': '지엠로드 현장대리인', 'org': '지엠로드'}],
         agenda='1. 10월 공정 실적\n2. 11월 받침 교체 계획\n3. 교통 통제 시간 조정', methods=('note',), status='reviewed',
         summary={'one_line': '10월 가설 작업대 설치 완료, 11월 둘째 주부터 받침 교체 착수 합의',
                  'agenda': [{'title': '10월 공정 실적', 'points': ['교좌 가설 작업대 5개소 설치 완료', '단면보수 A1 · P1 진행 중 (계획 대비 +2%)'], 'start': None},
                             {'title': '11월 받침 교체 계획', 'points': ['11/9 착수, A1 → P1 → P2 순서', '유압잭 4대 동시 인상, 인상량 3mm 이내 관리'], 'start': None},
                             {'title': '교통 통제 시간', 'points': ['출퇴근 시간(07~09시, 17~19시) 차로 통제 금지']}],
                  'decisions': ['받침 교체 11/9 착수', '교통 통제는 09~17시로 한정'],
                  'open_issues': ['A1 단면보수 면적 증가 → 설계변경 대상 여부 검토']},
         note_text='감리: 받침 인상 시 계측 기록 매회 제출 요청', locked=False, confirmed_by=ADMIN, confirmed_at=ts(dt.date(2026, 10, 31), '10:00'),
         created_by=ADMIN, created_at=ts(dt.date(2026, 10, 30), '13:50')),
    dict(id=MT2, project_id=P, title='감리단 받침 교체 시공 협의', held_at=ts(dt.date(2026, 11, 10), '10:30'), kind='감리 협의', place='한빛교 A1 현장',
         attendees=[{'name': '박성민', 'org': '○○감리단'}, {'name': '지엠로드 현장대리인', 'org': '지엠로드'}],
         agenda='받침 교체 시공 순서 · 계측 방법', methods=('note',), status='reviewed',
         summary={'one_line': '인상 계측은 다이얼게이지 4점, 교체 후 24시간 무재하 양생',
                  'agenda': [{'title': '시공 순서', 'points': ['거더 인상 → 기존 받침 철거 → 받침면 정리 → 신규 받침 설치 → 무수축 모르타르 → 하강']}],
                  'decisions': ['계측 다이얼게이지 4점, 기록지는 일보에 첨부', '무수축 모르타르 양생 24시간 후 하강'],
                  'open_issues': []},
         note_text=None, locked=False, confirmed_by=ADMIN, confirmed_at=ts(dt.date(2026, 11, 10), '17:00'), created_by=ADMIN, created_at=ts(dt.date(2026, 11, 10), '10:20')),
]))
out.append(ins('meeting_todos', [
    dict(id=uid('todo1'), meeting_id=MT1, project_id=P, text='A1 단면보수 실측 면적 산출 후 감리 제출', assignee_id=STAFF, assignee_name=None, due_date='2026-11-21', done=False, done_at=None, request_id=uid('rq2'), source='manual', sort=0),
    dict(id=uid('todo2'), meeting_id=MT1, project_id=P, text='교통 통제 시간 변경 안내문 게시', assignee_id=STAFF, assignee_name=None, due_date='2026-11-03', done=True, done_at=ts(dt.date(2026, 11, 2), '11:00'), request_id=None, source='manual', sort=1),
    dict(id=uid('todo3'), meeting_id=MT2, project_id=P, text='받침 인상 계측 기록지 양식 전달', assignee_id=None, assignee_name='박성민 (감리단)', due_date='2026-11-12', done=True, done_at=ts(dt.date(2026, 11, 11), '15:00'), request_id=None, source='manual', sort=0),
]))
out.append(ins('project_alerts', [
    dict(id=uid('al1'), project_id=P, meeting_id=MT1, todo_id=None, kind='decision', text='교통 통제는 09~17시로 한정 (출퇴근 시간 통제 금지)', due_date=None, pinned=True, closed=False, auto=True, created_by=ADMIN),
    dict(id=uid('al2'), project_id=P, meeting_id=MT1, todo_id=uid('todo1'), kind='todo', text='A1 단면보수 실측 면적 산출 후 감리 제출', due_date='2026-11-21', pinned=False, closed=False, auto=True, created_by=ADMIN),
    dict(id=uid('al3'), project_id=P, meeting_id=MT2, todo_id=None, kind='decision', text='받침 교체 후 무수축 모르타르 24시간 양생 뒤 하강', due_date=None, pinned=False, closed=False, auto=True, created_by=ADMIN),
]))

# 확정된 회의록엔 할 일을 못 넣으므로, 다 넣은 뒤 잠금
out.append(f"update gm.meetings set locked = true where id in ('{MT1}', '{MT2}');\n")

# ── 제품 · 납품 (회사 단위) ──
PRODUCTS = [
    ('qra', '관급', '내진장치', '[샘플] QRA 내진변위 제한장치', 'QRA-500', 'EA', 4320000, '24518801', '00000-2026-샘플01', '2025-01-11', '2027-01-10'),
    ('eb', '관급', '교량받침', '[샘플] 탄성받침 GM-EB', '2,000kN', 'EA', 6850000, '24518802', '00000-2026-샘플02', '2026-03-02', '2028-03-01'),
    ('rj', '사급', '신축이음', '[샘플] 레일형 신축이음장치 GM-RJ', '80mm', 'm', 1180000, None, None, None, None),
]
PR = {k: uid('prod-' + k) for k, *_ in PRODUCTS}
out.append(ins('products', [dict(id=PR[k], company_id=GMROAD, kind=kd, category=c, name=n, spec=s, unit=u, price=pr, maker='지엠로드',
    g2b_no=g, contract_no=cn, contract_start=cs, contract_end=ce, g2b_url=None, note='샘플 데이터', active=True, created_by=ADMIN)
    for k, kd, c, n, s, u, pr, g, cn, cs, ce in PRODUCTS]))
DELIV = [
    ('d1', 'qra', '2026-03-18', None, '2026년 금강교 내진보강공사', '대전지방국토관리청', '(주)서진건설', 24),
    ('d2', 'eb', '2026-05-07', None, '청풍대교 받침 교체공사', '충청북도 도로관리사업소', '(주)청풍종합건설', 18),
    ('d3', 'rj', '2026-06-22', None, '남한강교 신축이음 보수공사', '원주지방국토관리청', '(주)남강토건', 42.5),
    ('d4', 'qra', '2026-08-29', None, '2026년 서호교 내진보강공사', '경기도건설본부', '(주)서호개발', 16),
    ('d5', 'eb', '2026-11-06', P, None, '충청북도 도로관리사업소', '(주)대한종합건설', 12),
    ('d6', 'qra', '2026-11-06', P, None, '충청북도 도로관리사업소', '(주)대한종합건설', 8),
]
price = {k: p for k, _, _, _, _, _, p, *_ in PRODUCTS}
kindof = {k: kd for k, kd, *_ in PRODUCTS}
out.append(ins('deliveries', [dict(id=uid('deliv-' + k), product_id=PR[p], company_id=GMROAD, kind=kindof[p], delivered_on=d, project_id=pj,
    project_name=pn, client=cl, contractor=ct, qty=qt, price=price[p], note='샘플 데이터', created_by=ADMIN)
    for k, p, d, pj, pn, cl, ct, qt in DELIV]))

remove = f"""-- 샘플 데이터 지우기 (make_sample.py 가 만든 것만)
begin;
delete from gm.notifications where project_id = '{P}';
delete from gm.deliveries where id in ({', '.join(q(uid('deliv-' + k)) for k, *_ in DELIV)});
delete from gm.products where id in ({', '.join(q(v) for v in PR.values())});
delete from gm.projects where id = '{P}';
commit;
"""
head = f"""-- 앱 화면 확인용 샘플 데이터 (make_sample.py 로 생성 — 직접 고치지 말 것)
\\set ON_ERROR_STOP on
begin;
-- 본사 관리자(gmconst) 이름으로 넣음 → 승인 · 확인 상태가 그대로 들어감
select set_config('request.jwt.claims', '{{"sub":"{ADMIN}","role":"authenticated"}}', true);
select set_config('request.jwt.claim.sub', '{ADMIN}', true);
-- 이미 있으면 지우고 다시
delete from gm.notifications where project_id = '{P}';
delete from gm.deliveries where id in ({', '.join(q(uid('deliv-' + k)) for k, *_ in DELIV)});
delete from gm.products where id in ({', '.join(q(v) for v in PR.values())});
delete from gm.projects where id = '{P}';
"""
tail = f"""
-- 샘플이 만든 알림은 보낸 것으로 (폰 푸시 안 감)
update gm.notifications set pushed_at = now() where project_id = '{P}' and pushed_at is null;
commit;
"""
open(os.path.join(HERE, 'sample.sql'), 'w', encoding='utf-8').write(head + '\n'.join(out) + tail)
open(os.path.join(HERE, 'remove.sql'), 'w', encoding='utf-8').write(remove)
print(f'project {P}: 일보 {len(reports)} · 인원 {len(crews)} · 장비 {len(equip)} · 수량 {len(entries)} · 자재수불 {len(moves)}')
