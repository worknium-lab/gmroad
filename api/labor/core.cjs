/* 지엠로드 현장 노무비 관리 — 계산·파싱·엑셀 생성 코어
 * 브라우저(window.LaborCore)와 Node(module.exports) 양쪽에서 동작.
 * 엑셀 수식과 화면 미리보기 계산은 같은 규칙을 따른다(정수, 10원 미만 절사 등). */
(function (root) {
  'use strict';

  // ---------- 기본 설정 ----------
  function defaultSettings() {
    return {
      site: '공릉천교', project: '', siteAddr: '',
      company: '(주)지엠로드', ceo: '', bizAddr: '', bizTel: '',
      year: 2026, month: 10, payDay: 10,
      workStart: '07:00', workEnd: '17:00', breakTime: '12:00~13:00', holiday: '일요일',
      gongsuMode: '출퇴근', baseHours: 8, breakHours: 1,
      rates: {
        emp: 0.009, pen: 0.0475, hlt: 0.03595, ltc: 0.1314,
        taxDed: 150000, taxRate: 0.06, taxCredit: 0.55, local: 0.1, minTax: 1000,
        minDays: 8, minPay: 2200000, penCap: 6370000
      }
    };
  }

  // ---------- 숫자 규칙 ----------
  const r2 = (x) => Math.round(x * 100) / 100;
  const trunc0 = (x) => Math.trunc(r2(x));
  const trunc10 = (x) => Math.trunc(r2(x) / 10) * 10;
  const trunc1000 = (x) => Math.trunc(x / 1000) * 1000;
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- 값 정규화 ----------
  function serialToYMD(s) {
    const d = new Date(Math.round((Math.floor(s) - 25569) * 86400000));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function normDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number') return v > 20000 ? serialToYMD(v) : '';
    const s = String(v).trim();
    let m = s.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
    if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return '';
  }
  function normTime(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return pad(v.getHours()) + ':' + pad(v.getMinutes());
    if (typeof v === 'number') {
      const f = v - Math.floor(v);
      if (f === 0 && v >= 1) return '';
      const mins = Math.round(f * 1440);
      return pad(Math.floor(mins / 60) % 24) + ':' + pad(mins % 60);
    }
    const s = String(v).trim();
    const all = s.match(/(\d{1,2}):(\d{2})/g);
    if (all) { const t = all[all.length - 1].split(':'); return pad(+t[0]) + ':' + t[1]; }
    const m = s.match(/(\d{1,2})시\s*(\d{1,2})?/);
    if (m) return pad(+m[1]) + ':' + pad(+(m[2] || 0));
    return '';
  }
  function normBirth(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) return serialToYMD(v);
    const s = String(v).trim();
    const d = normDate(s);
    if (d) return d;
    const m = s.replace(/[^0-9]/g, '').match(/^(\d{2})(\d{2})(\d{2})/);
    if (m && s.replace(/[^0-9*]/g, '').length <= 13) {
      const yy = +m[1];
      return (yy > 10 ? '19' : '20') + m[1] + '-' + m[2] + '-' + m[3];
    }
    return s;
  }
  const toMin = (t) => { if (!t) return null; const p = t.split(':'); return +p[0] * 60 + +p[1]; };

  // ---------- 전자카드 헤더 인식 ----------
  function classify(h) {
    const s = String(h || '').replace(/\s/g, '');
    if (!s) return null;
    if (/성명|이름|근로자명/.test(s)) return 'name';
    if (/생년월일|주민|생일/.test(s)) return 'birth';
    if (/직종|공종|직무/.test(s)) return 'job';
    if (/퇴근|퇴장|종료/.test(s)) return (/일자|날짜/.test(s) && !/시간|시각|일시/.test(s)) ? null : 'out';
    if (/출근|입장|시작/.test(s)) return (/일자|날짜/.test(s) && !/시간|시각|일시/.test(s)) ? 'date' : 'in';
    if (/일자|날짜|근무일|근로일|출역일/.test(s)) return 'date';
    return null;
  }
  function detectHeader(rows) {
    let best = { row: -1, map: {}, score: 0 };
    for (let r = 0; r < Math.min(rows.length, 25); r++) {
      const map = {}; let score = 0;
      (rows[r] || []).forEach((h, c) => {
        const k = classify(h);
        if (k && map[k] === undefined) { map[k] = c; score++; }
      });
      if (map.name !== undefined && score > best.score) best = { row: r, map, score };
    }
    return best;
  }

  // 원본 행 → 일자별 출퇴근 레코드(같은 사람·같은 날 여러 번 태그 시 최초 출근/최종 퇴근)
  function extractRecords(rows, headerRow, map) {
    const bucket = new Map(); const order = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const name = String(row[map.name] ?? '').trim();
      if (!name || /합계|소계|총계/.test(name)) continue;
      const birth = map.birth !== undefined ? normBirth(row[map.birth]) : '';
      const job = map.job !== undefined ? String(row[map.job] ?? '').trim() : '';
      const vin = map.in !== undefined ? row[map.in] : '';
      const vout = map.out !== undefined ? row[map.out] : '';
      let date = map.date !== undefined ? normDate(row[map.date]) : '';
      if (!date) date = normDate(vin) || normDate(vout);
      if (!date) continue;
      const tin = normTime(vin), tout = normTime(vout);
      const key = name + '|' + birth + '|' + date;
      let rec = bucket.get(key);
      if (!rec) { rec = { name, birth, date, job, tin: '', tout: '', taps: 0 }; bucket.set(key, rec); order.push(rec); }
      rec.taps++;
      if (job && !rec.job) rec.job = job;
      if (tin && (!rec.tin || tin < rec.tin)) rec.tin = tin;
      if (tout && (!rec.tout || tout > rec.tout)) rec.tout = tout;
    }
    order.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'ko')));
    return order;
  }

  function monthsOf(records) {
    const c = {};
    records.forEach((r) => { const k = r.date.slice(0, 7); c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).sort().map((k) => ({ ym: k, count: c[k] }));
  }

  // ---------- 계산 ----------
  function hoursOf(rec, S) {
    const a = toMin(rec.tin), b = toMin(rec.tout);
    if (a === null || b === null) return 0;
    return Math.max(0, r2((b - a) / 60 - S.breakHours));
  }
  function gongsuOf(rec, S) {
    if (rec.override !== undefined && rec.override !== null && rec.override !== '') return +rec.override;
    if (!rec.tin || !rec.tout) return 0;
    if (S.gongsuMode === '근무시간') return Math.floor(r2(hoursOf(rec, S) / S.baseHours) / 0.5 + 1e-9) * 0.5;
    return 1;
  }
  function lastDayOf(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  const wkey = (w) => w.name + '|' + w.birth;

  // 근로자 목록(레코드 기준, 기존 입력값 유지)
  function buildWorkers(records, prev) {
    const old = new Map((prev || []).map((w) => [wkey(w), w]));
    const seen = new Map();
    records.forEach((r) => {
      const k = r.name + '|' + r.birth;
      if (!seen.has(k)) {
        const o = old.get(k) || {};
        seen.set(k, {
          name: r.name, birth: r.birth, job: o.job || r.job || '', wage: o.wage ?? null,
          ins: o.ins || '자동', addr: o.addr || '', tel: o.tel || '', bank: o.bank || '', acct: o.acct || ''
        });
      } else if (r.job && !seen.get(k).job) seen.get(k).job = r.job;
    });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  function wageOf(w, jobRates) {
    if (w.wage !== null && w.wage !== undefined && w.wage !== '') return +w.wage;
    const j = jobRates.find((x) => x.job === w.job);
    return j ? +j.wage : 0;
  }

  function computeStatement(S, records, workers, jobRates) {
    const R = S.rates; const ym = S.year + '-' + pad(S.month);
    const last = lastDayOf(S.year, S.month);
    const recs = records.filter((r) => r.date.slice(0, 7) === ym);
    const rows = workers.map((w, i) => {
      const days = new Array(32).fill(0);
      recs.forEach((r) => { if (r.name === w.name && r.birth === w.birth) days[+r.date.slice(8, 10)] += gongsuOf(r, S); });
      let nDays = 0, total = 0, first = null, lastWork = null;
      for (let d = 1; d <= last; d++) if (days[d] > 0) { nDays++; total = r2(total + days[d]); if (!first) first = d; lastWork = d; }
      const wage = wageOf(w, jobRates);
      const amount = trunc0(total * wage);
      let tax = 0, local = 0;
      if (nDays > 0) {
        const x = r2(Math.max(0, amount / nDays - R.taxDed) * R.taxRate * (1 - R.taxCredit));
        const daily = x < R.minTax ? 0 : trunc10(x);
        tax = daily * nDays;
        local = trunc10((tax / nDays) * R.local) * nDays;
      }
      const ins = w.ins === '적용' ? true : w.ins === '제외' ? false : (nDays >= R.minDays || amount >= R.minPay);
      const emp = trunc10(amount * R.emp);
      const pen = ins ? trunc10(trunc1000(Math.min(amount, R.penCap)) * R.pen) : 0;
      const hlt = ins ? trunc10(amount * R.hlt) : 0;
      const ltc = trunc10(hlt * R.ltc);
      const ded = tax + local + emp + pen + hlt + ltc;
      return {
        i: i + 1, w, days, nDays, total, wage, amount, tax, local, emp, pen, hlt, ltc, ded, net: amount - ded, ins,
        first: first ? ym + '-' + pad(first) : '', lastWork: lastWork ? ym + '-' + pad(lastWork) : ''
      };
    });
    const sum = {}; ['nDays', 'total', 'amount', 'tax', 'local', 'emp', 'pen', 'hlt', 'ltc', 'ded', 'net'].forEach((k) => {
      sum[k] = rows.reduce((a, r) => (k === 'total' ? r2(a + r[k]) : a + r[k]), 0);
    });
    sum.days = new Array(32).fill(0);
    sum.heads = new Array(32).fill(0);
    rows.forEach((r) => { for (let d = 1; d <= last; d++) { sum.days[d] = r2(sum.days[d] + r.days[d]); if (r.days[d] > 0) sum.heads[d]++; } });
    return { rows, sum, last, recs };
  }

  // ---------- 엑셀 생성 (ExcelJS) ----------
  const FONT = '맑은 고딕';
  const thin = { style: 'thin', color: { argb: 'FF7F8794' } };
  const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
  const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
  const SUM_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
  const SUN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE9E9' } };
  const SAT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FB' } };
  const WON = '#,##0;-#,##0;"-"';
  const GS = '0.0;-0.0;;@';

  function colL(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function ymdSerial(ymd) { const p = ymd.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000 + 25569; }
  function f(formula, result) { return { formula: formula.replace(/^=/, ''), result }; }
  function styleRange(ws, r1, c1, r2_, c2, fn) { for (let r = r1; r <= r2_; r++) for (let c = c1; c <= c2; c++) fn(ws.getCell(r, c)); }

  function buildWorkbook(ExcelJS, S, records, workers, jobRates) {
    const st = computeStatement(S, records, workers, jobRates);
    const R = S.rates;
    const wb = new ExcelJS.Workbook();
    wb.creator = '지엠로드 통합관리도구';
    wb.calcProperties.fullCalcOnLoad = true;
    const ym = S.year + '-' + pad(S.month);
    const recs = st.recs;

    // ---- 1. 설정 ----
    const ws0 = wb.addWorksheet('설정', { properties: { tabColor: { argb: 'FF1F4E8C' } } });
    ws0.columns = [{ width: 3 }, { width: 30 }, { width: 26 }, { width: 46 }];
    ws0.getCell('B1').value = '노무비 산정 설정'; ws0.getCell('B1').font = { name: FONT, size: 14, bold: true };
    ws0.getCell('D1').value = '노란 칸은 직접 입력하는 값입니다. 바꾸면 모든 시트가 다시 계산됩니다.';
    ws0.getCell('D1').font = { name: FONT, size: 9, color: { argb: 'FF5B6577' } };
    const setRows = [
      [3, '현장명', S.site, '@'], [4, '공사명', S.project, '@'], [5, '현장주소', S.siteAddr, '@'],
      [6, '사업체명', S.company, '@'], [7, '대표자', S.ceo, '@'], [8, '사업장 주소', S.bizAddr, '@'], [9, '전화', S.bizTel, '@'],
      [10, '귀속연도', S.year, '0'], [11, '귀속월', S.month, '0'], [12, '임금지급일(매월 ○일)', S.payDay, '0'],
      [13, '시업시각', S.workStart, '@'], [14, '종업시각', S.workEnd, '@'], [15, '휴게시간', S.breakTime, '@'], [16, '주휴일', S.holiday, '@'],
      [17, '공수 산정방식 (출퇴근 / 근무시간)', S.gongsuMode, '@'], [18, '1공수 기준시간(h)', S.baseHours, '0.0'], [19, '휴게 차감시간(h)', S.breakHours, '0.0'],
      [22, '고용보험 (근로자 부담)', R.emp, '0.000%'], [23, '국민연금 (근로자 부담)', R.pen, '0.000%'],
      [24, '건강보험 (근로자 부담)', R.hlt, '0.000%'], [25, '장기요양 (건강보험료 대비)', R.ltc, '0.00%'],
      [26, '일용근로소득 공제액(1일)', R.taxDed, '#,##0'], [27, '소득세율', R.taxRate, '0%'], [28, '근로소득세액공제율', R.taxCredit, '0%'],
      [29, '지방소득세율 (소득세 대비)', R.local, '0%'], [30, '소액부징수 기준(1일 소득세)', R.minTax, '#,##0'],
      [31, '연금·건강 자동적용 최소 출역일수', R.minDays, '0'], [32, '연금 자동적용 월 소득기준', R.minPay, '#,##0'],
      [33, '국민연금 기준소득월액 상한', R.penCap, '#,##0']
    ];
    const notes = {
      17: '출퇴근: 출근·퇴근 모두 태그된 날 1공수 / 근무시간: (퇴근-출근-휴게)÷기준시간, 0.5 단위 내림',
      22: '총액 × 요율, 10원 미만 절사', 23: '천원 미만 절사한 총액(상한 적용) × 요율, 10원 미만 절사',
      24: '총액 × 요율, 10원 미만 절사', 25: '건강보험료 × 요율, 10원 미만 절사',
      26: '1일 소득세 = (일평균 임금 − 공제액) × 세율 × (1 − 세액공제율), 10원 미만 절사',
      30: '1일 소득세가 이 금액 미만이면 징수하지 않음', 31: '건설일용: 1개월 이상 근로 + 월 8일 이상(또는 월 소득기준 이상)',
      33: '매년 7월 고시값으로 갱신하세요'
    };
    ws0.getCell('B21').value = '공제 요율'; ws0.getCell('B21').font = { name: FONT, bold: true, size: 11 };
    setRows.forEach(([r, label, val, fmt]) => {
      const a = ws0.getCell(r, 2), b = ws0.getCell(r, 3);
      a.value = label; a.font = { name: FONT, size: 10 }; a.border = BORDER; a.fill = HEAD_FILL;
      b.value = val === undefined ? '' : val; b.numFmt = fmt; b.font = { name: FONT, size: 10, bold: true }; b.border = BORDER; b.fill = INPUT_FILL;
      b.alignment = { horizontal: fmt === '@' ? 'left' : 'right' };
      if (notes[r]) { const n = ws0.getCell(r, 4); n.value = notes[r]; n.font = { name: FONT, size: 9, color: { argb: 'FF5B6577' } }; }
    });
    ws0.getCell('C17').dataValidation = { type: 'list', allowBlank: false, formulae: ['"출퇴근,근무시간"'] };
    ws0.getCell('B34').value = '귀속월 말일 (자동)'; ws0.getCell('B34').border = BORDER; ws0.getCell('B34').fill = HEAD_FILL; ws0.getCell('B34').font = { name: FONT, size: 10 };
    ws0.getCell('C34').value = f('DAY(EOMONTH(DATE(C10,C11,1),0))', st.last); ws0.getCell('C34').border = BORDER; ws0.getCell('C34').font = { name: FONT, size: 10 };
    const SET = (r) => "'설정'!$C$" + r;

    // ---- 2. 직종단가 ----
    const wsJ = wb.addWorksheet('직종단가');
    wsJ.columns = [{ header: '직종', width: 18 }, { header: '일급(원)', width: 16 }];
    const jr = jobRates.length ? jobRates : [{ job: '', wage: 0 }];
    jr.forEach((j) => wsJ.addRow([j.job, +j.wage || 0]));
    const jLast = Math.max(2, jr.length + 1) + 20; // 추가 입력 여유 20행
    styleRange(wsJ, 1, 1, jLast, 2, (c) => { c.border = BORDER; c.font = { name: FONT, size: 10, bold: c.row === 1 }; if (c.row === 1) c.fill = HEAD_FILL; else c.fill = INPUT_FILL; if (c.col === 2) c.numFmt = '#,##0'; });
    wsJ.getCell('D1').value = '근로자 시트에서 개인 일급을 비워두면 이 표의 직종 단가를 씁니다.';
    wsJ.getCell('D1').font = { name: FONT, size: 9, color: { argb: 'FF5B6577' } };
    const JR = "'직종단가'!$A$2:$B$" + jLast;

    // ---- 3. 전자카드내역 ----
    const wsE = wb.addWorksheet('전자카드내역');
    const eHead = ['순번', '성명', '생년월일', '근무일자', '출근시각', '퇴근시각', '직종(원본)', '근무시간(h)', '공수', '일', '근로자키'];
    wsE.columns = [6, 10, 12, 12, 9, 9, 12, 11, 7, 5, 22].map((w) => ({ width: w }));
    wsE.addRow(eHead);
    recs.forEach((rec, i) => {
      const r = i + 2;
      const hours = hoursOf(rec, S); const gs = gongsuOf(rec, S);
      const row = wsE.getRow(r);
      row.getCell(1).value = i + 1;
      row.getCell(2).value = rec.name;
      row.getCell(3).value = rec.birth;
      row.getCell(4).value = ymdSerial(rec.date); row.getCell(4).numFmt = 'yyyy-mm-dd';
      if (rec.tin) { row.getCell(5).value = toMin(rec.tin) / 1440; row.getCell(5).numFmt = 'hh:mm'; }
      if (rec.tout) { row.getCell(6).value = toMin(rec.tout) / 1440; row.getCell(6).numFmt = 'hh:mm'; }
      row.getCell(7).value = rec.job;
      row.getCell(8).value = f(`IF(OR(E${r}="",F${r}=""),0,MAX(0,ROUND((F${r}-E${r})*24-${SET(19)},2)))`, hours);
      row.getCell(8).numFmt = '0.00';
      if (rec.override !== undefined && rec.override !== null && rec.override !== '') {
        row.getCell(9).value = +rec.override; row.getCell(9).fill = INPUT_FILL;
      } else {
        row.getCell(9).value = f(`IF(OR(E${r}="",F${r}=""),0,IF(${SET(17)}="근무시간",FLOOR(ROUND(H${r}/${SET(18)},2),0.5),1))`, gs);
      }
      row.getCell(9).numFmt = '0.0';
      row.getCell(10).value = f(`DAY(D${r})`, +rec.date.slice(8, 10));
      row.getCell(11).value = f(`B${r}&"|"&C${r}`, rec.name + '|' + rec.birth);
    });
    const eLast = Math.max(2, recs.length + 1);
    styleRange(wsE, 1, 1, eLast, 11, (c) => {
      c.border = BORDER; c.font = { name: FONT, size: 10, bold: c.row === 1 };
      if (c.row === 1) { c.fill = HEAD_FILL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; }
      else if ([1, 4, 5, 6, 9, 10].includes(c.col)) c.alignment = { horizontal: 'center' };
    });
    recs.forEach((rec, i) => { if (!rec.tin || !rec.tout) styleRange(wsE, i + 2, 5, i + 2, 6, (c) => { c.fill = SUN_FILL; }); });
    wsE.views = [{ state: 'frozen', ySplit: 1 }];
    wsE.autoFilter = { from: 'A1', to: 'K1' };
    const ER = (col) => `'전자카드내역'!$${col}$2:$${col}$${eLast}`;

    // ---- 4. 근로자 ----
    const wsW = wb.addWorksheet('근로자');
    const wHead = ['순번', '성명', '생년월일', '근로자키', '직종', '일급(원)', '연금·건강 적용\n(자동/적용/제외)', '주소', '연락처', '은행', '계좌번호', '첫 출역일', '마지막 출역일'];
    wsW.columns = [6, 10, 12, 22, 12, 12, 14, 34, 15, 10, 18, 12, 12].map((w) => ({ width: w }));
    wsW.addRow(wHead); wsW.getRow(1).height = 32;
    st.rows.forEach((row, i) => {
      const r = i + 2; const w = row.w; const x = wsW.getRow(r);
      x.getCell(1).value = i + 1; x.getCell(2).value = w.name; x.getCell(3).value = w.birth;
      x.getCell(4).value = f(`B${r}&"|"&C${r}`, w.name + '|' + w.birth);
      x.getCell(5).value = w.job;
      if (w.wage !== null && w.wage !== undefined && w.wage !== '') { x.getCell(6).value = +w.wage; x.getCell(6).fill = INPUT_FILL; }
      else x.getCell(6).value = f(`IFERROR(VLOOKUP(E${r},${JR},2,FALSE),0)`, row.wage);
      x.getCell(6).numFmt = '#,##0';
      x.getCell(7).value = w.ins || '자동';
      x.getCell(7).dataValidation = { type: 'list', allowBlank: false, formulae: ['"자동,적용,제외"'] };
      x.getCell(8).value = w.addr; x.getCell(9).value = w.tel; x.getCell(10).value = w.bank; x.getCell(11).value = w.acct;
      x.getCell(12).value = f(`_xlfn.MINIFS(${ER('D')},${ER('K')},D${r},${ER('I')},">0")`, row.first ? ymdSerial(row.first) : 0);
      x.getCell(13).value = f(`_xlfn.MAXIFS(${ER('D')},${ER('K')},D${r},${ER('I')},">0")`, row.lastWork ? ymdSerial(row.lastWork) : 0);
      x.getCell(12).numFmt = 'yyyy-mm-dd;;'; x.getCell(13).numFmt = 'yyyy-mm-dd;;';
    });
    const wLast = Math.max(2, st.rows.length + 1);
    styleRange(wsW, 1, 1, wLast, 13, (c) => {
      c.border = BORDER; c.font = { name: FONT, size: 10, bold: c.row === 1 };
      if (c.row === 1) { c.fill = HEAD_FILL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; }
      else { if ([5, 7, 8, 9, 10, 11].includes(c.col) && !c.fill) c.fill = INPUT_FILL; if ([1, 3, 7, 12, 13].includes(c.col)) c.alignment = { horizontal: 'center' }; }
    });
    wsW.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];

    // ---- 5. 노무비명세서 ----
    const wsS = wb.addWorksheet('노무비명세서', { properties: { tabColor: { argb: 'FF0F6E61' } } });
    const D0 = 5; // E열 = 1일
    const C = {}; ['nDays', 'total', 'wage', 'amount', 'tax', 'local', 'emp', 'pen', 'hlt', 'ltc', 'ded', 'net', 'ins', 'bank', 'acct'].forEach((k, i) => { C[k] = D0 + 31 + i; });
    const L = (k) => colL(C[k]);
    const widths = [5, 9, 11, 9]; for (let d = 1; d <= 31; d++) widths.push(3.6);
    widths.push(6, 7, 10, 13, 10, 9, 10, 11, 11, 10, 11, 13, 7, 9, 16);
    wsS.columns = widths.map((w) => ({ width: w }));
    const lastCol = C.acct;
    wsS.mergeCells(1, 1, 1, lastCol);
    wsS.getCell(1, 1).value = '노 무 비  지 급 명 세 서';
    wsS.getCell(1, 1).font = { name: FONT, size: 18, bold: true }; wsS.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    wsS.getRow(1).height = 34;
    wsS.mergeCells(2, 1, 2, 20);
    wsS.getCell(2, 1).value = f(`"현장명 : "&${SET(3)}&IF(${SET(4)}="",""," ("&${SET(4)}&")")`, '현장명 : ' + S.site + (S.project ? ' (' + S.project + ')' : ''));
    wsS.mergeCells(2, 21, 2, lastCol);
    wsS.getCell(2, 21).value = f(`"귀속 : "&${SET(10)}&"년 "&${SET(11)}&"월   사업체명 : "&${SET(6)}`, '귀속 : ' + S.year + '년 ' + S.month + '월   사업체명 : ' + S.company);
    wsS.getCell(2, 21).alignment = { horizontal: 'right' };
    [wsS.getCell(2, 1), wsS.getCell(2, 21)].forEach((c) => { c.font = { name: FONT, size: 11, bold: true }; });

    const H1 = 4, H2 = 5, FIRST = 6;
    const heads = [[1, '번호'], [2, '성명'], [3, '생년월일'], [4, '직종']];
    heads.forEach(([c, t]) => { wsS.mergeCells(H1, c, H2, c); wsS.getCell(H1, c).value = t; });
    const wk = (d) => (d > st.last ? '' : '일월화수목금토'[new Date(Date.UTC(S.year, S.month - 1, d)).getUTCDay()]);
    for (let d = 1; d <= 31; d++) {
      const c = D0 + d - 1, L1 = colL(c);
      wsS.getCell(H1, c).value = f(`IF(${d}<=${SET(34)},${d},"")`, d <= st.last ? d : '');
      wsS.getCell(H2, c).value = f(`IF(${L1}$${H1}="","",CHOOSE(WEEKDAY(DATE(${SET(10)},${SET(11)},${L1}$${H1})),"일","월","화","수","목","금","토"))`, wk(d));
    }
    const moneyHeads = [['nDays', '출역\n일수'], ['total', '총\n공수'], ['wage', '일급'], ['amount', '노무비\n총액'], ['tax', '소득세'], ['local', '지방\n소득세'],
      ['emp', '고용\n보험'], ['pen', '국민\n연금'], ['hlt', '건강\n보험'], ['ltc', '장기\n요양'], ['ded', '공제계'], ['net', '차감\n지급액'], ['ins', '연금·\n건강'], ['bank', '은행'], ['acct', '계좌번호']];
    moneyHeads.forEach(([k, t]) => { wsS.mergeCells(H1, C[k], H2, C[k]); wsS.getCell(H1, C[k]).value = t; });
    wsS.getRow(H1).height = 18; wsS.getRow(H2).height = 18;

    st.rows.forEach((row, i) => {
      const r = FIRST + i, wr = i + 2; const x = wsS.getRow(r);
      const W = (col) => `'근로자'!$${col}$${wr}`;
      x.getCell(1).value = i + 1;
      x.getCell(2).value = f(`${W('B')}`, row.w.name);
      x.getCell(3).value = f(`${W('C')}`, row.w.birth);
      x.getCell(4).value = f(`${W('E')}`, row.w.job);
      for (let d = 1; d <= 31; d++) {
        const c = D0 + d - 1, L1 = colL(c);
        x.getCell(c).value = f(`IF(${L1}$${H1}="","",SUMIFS(${ER('I')},${ER('K')},${W('D')},${ER('J')},${L1}$${H1}))`, d <= st.last ? row.days[d] : '');
        x.getCell(c).numFmt = GS;
      }
      const dr = `${colL(D0)}${r}:${colL(D0 + 30)}${r}`;
      x.getCell(C.nDays).value = f(`COUNTIF(${dr},">0")`, row.nDays);
      x.getCell(C.total).value = f(`SUM(${dr})`, row.total); x.getCell(C.total).numFmt = '0.0';
      x.getCell(C.wage).value = f(`${W('F')}`, row.wage);
      x.getCell(C.amount).value = f(`TRUNC(${L('total')}${r}*${L('wage')}${r},0)`, row.amount);
      const N = `${L('nDays')}${r}`, A = `${L('amount')}${r}`;
      const X = `ROUND(MAX(0,${A}/${N}-${SET(26)})*${SET(27)}*(1-${SET(28)}),2)`;
      x.getCell(C.tax).value = f(`IF(${N}=0,0,IF(${X}<${SET(30)},0,TRUNC(${X},-1))*${N})`, row.tax);
      x.getCell(C.local).value = f(`IF(${N}=0,0,TRUNC(ROUND(${L('tax')}${r}/${N}*${SET(29)},2),-1)*${N})`, row.local);
      x.getCell(C.ins).value = f(`IF(${W('G')}="적용","Y",IF(${W('G')}="제외","N",IF(OR(${N}>=${SET(31)},${A}>=${SET(32)}),"Y","N")))`, row.ins ? 'Y' : 'N');
      const I = `${L('ins')}${r}`;
      x.getCell(C.emp).value = f(`TRUNC(ROUND(${A}*${SET(22)},2),-1)`, row.emp);
      x.getCell(C.pen).value = f(`IF(${I}="Y",TRUNC(ROUND(TRUNC(MIN(${A},${SET(33)}),-3)*${SET(23)},2),-1),0)`, row.pen);
      x.getCell(C.hlt).value = f(`IF(${I}="Y",TRUNC(ROUND(${A}*${SET(24)},2),-1),0)`, row.hlt);
      x.getCell(C.ltc).value = f(`TRUNC(ROUND(${L('hlt')}${r}*${SET(25)},2),-1)`, row.ltc);
      x.getCell(C.ded).value = f(`SUM(${L('tax')}${r}:${L('ltc')}${r})`, row.ded);
      x.getCell(C.net).value = f(`${A}-${L('ded')}${r}`, row.net);
      x.getCell(C.bank).value = f(`IF(${W('J')}="","",${W('J')})`, row.w.bank || '');
      x.getCell(C.acct).value = f(`IF(${W('K')}="","",${W('K')})`, row.w.acct || '');
      ['wage', 'amount', 'tax', 'local', 'emp', 'pen', 'hlt', 'ltc', 'ded', 'net'].forEach((k) => { x.getCell(C[k]).numFmt = WON; });
    });
    const LASTW = FIRST + Math.max(1, st.rows.length) - 1;
    const SUMR = LASTW + 1, HEADR = LASTW + 2;
    wsS.mergeCells(SUMR, 1, SUMR, 4); wsS.getCell(SUMR, 1).value = '합  계 (공수)';
    wsS.mergeCells(HEADR, 1, HEADR, 4); wsS.getCell(HEADR, 1).value = '일별 출역인원';
    for (let d = 1; d <= 31; d++) {
      const c = D0 + d - 1, L1 = colL(c);
      wsS.getCell(SUMR, c).value = f(`IF(${L1}$${H1}="","",SUM(${L1}${FIRST}:${L1}${LASTW}))`, d <= st.last ? st.sum.days[d] : '');
      wsS.getCell(SUMR, c).numFmt = GS;
      wsS.getCell(HEADR, c).value = f(`IF(${L1}$${H1}="","",COUNTIF(${L1}${FIRST}:${L1}${LASTW},">0"))`, d <= st.last ? st.sum.heads[d] : '');
      wsS.getCell(HEADR, c).numFmt = '0;-0;;@';
    }
    ['nDays', 'total', 'amount', 'tax', 'local', 'emp', 'pen', 'hlt', 'ltc', 'ded', 'net'].forEach((k) => {
      const c = wsS.getCell(SUMR, C[k]);
      c.value = f(`SUM(${L(k)}${FIRST}:${L(k)}${LASTW})`, st.sum[k]);
      c.numFmt = k === 'total' ? '0.0' : k === 'nDays' ? '0' : WON;
    });
    wsS.getCell(HEADR, C.nDays).value = f(`COUNTIF(${L('nDays')}${FIRST}:${L('nDays')}${LASTW},">0")&"명"`, st.rows.filter((r) => r.nDays > 0).length + '명');

    styleRange(wsS, H1, 1, HEADR, lastCol, (c) => {
      c.border = BORDER;
      const isHead = c.row <= H2, isSum = c.row >= SUMR;
      c.font = { name: FONT, size: c.col >= D0 && c.col < D0 + 31 ? 9 : 10, bold: isHead || isSum };
      if (isHead) { c.fill = HEAD_FILL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; }
      else if (isSum) { c.fill = SUM_FILL; c.alignment = { horizontal: c.col <= 4 || (c.col >= D0 && c.col < D0 + 31) ? 'center' : 'right', vertical: 'middle' }; }
      else if (c.col <= 4 || (c.col >= D0 && c.col < D0 + 31) || c.col === C.nDays || c.col === C.total || c.col === C.ins) c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    for (let d = 1; d <= st.last; d++) {
      const dow = new Date(Date.UTC(S.year, S.month - 1, d)).getUTCDay();
      if (dow === 0 || dow === 6) [H1, H2].forEach((r) => { wsS.getCell(r, D0 + d - 1).fill = dow === 0 ? SUN_FILL : SAT_FILL; });
    }
    for (let r = FIRST; r <= LASTW; r++) wsS.getRow(r).height = 20;
    wsS.getCell(HEADR + 2, 1).value = '※ 공수는 전자카드내역 시트에서 자동 집계됩니다. 소득세 = 1일 소득세(일평균 임금 기준) × 출역일수, 4대보험은 설정 시트의 요율 적용(10원 미만 절사).';
    wsS.getCell(HEADR + 2, 1).font = { name: FONT, size: 9, color: { argb: 'FF5B6577' } };
    wsS.views = [{ state: 'frozen', xSplit: 4, ySplit: H2 }];
    wsS.pageSetup = { paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    wsS.pageSetup.printTitlesRow = `${H1}:${H2}`;

    // ---- 6. 근로계약서 ----
    const wsC = wb.addWorksheet('근로계약서', { properties: { tabColor: { argb: 'FF8A4B00' } } });
    wsC.columns = [{ width: 3 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 3 }];
    const BLOCK = 40;
    const dateTxt = (cell) => `IF(${cell}=0,"     년     월     일",YEAR(${cell})&"년 "&MONTH(${cell})&"월 "&DAY(${cell})&"일")`;
    const ymdTxt = (s) => { if (!s) return '     년     월     일'; const p = s.split('-'); return +p[0] + '년 ' + +p[1] + '월 ' + +p[2] + '일'; };
    const fmtWon = (n) => Number(n || 0).toLocaleString('en-US');
    st.rows.forEach((row, i) => {
      const b = i * BLOCK + 1, wr = i + 2, sr = FIRST + i, w = row.w;
      const W = (col) => `'근로자'!$${col}$${wr}`;
      const insCell = `'노무비명세서'!$${L('ins')}$${sr}`;
      const put = (r, c, v, opt) => {
        const cell = wsC.getCell(b + r, c); cell.value = v;
        cell.font = { name: FONT, size: (opt && opt.size) || 10.5, bold: !!(opt && opt.bold) };
        cell.alignment = { vertical: 'middle', wrapText: true, horizontal: (opt && opt.h) || 'left' };
        return cell;
      };
      const line = (r, label, value, h) => { put(r, 2, label, { bold: true }); wsC.mergeCells(b + r, 3, b + r, 6); put(r, 3, value); if (h) wsC.getRow(b + r).height = h; };
      wsC.mergeCells(b + 1, 2, b + 1, 6); put(1, 2, '건설일용근로자 표준근로계약서', { size: 18, bold: true, h: 'center' }); wsC.getRow(b + 1).height = 40;
      wsC.mergeCells(b + 3, 2, b + 3, 6);
      put(3, 2, f(`${SET(6)}&" (이하 ""사업주""라 함)과(와) "&${W('B')}&" (이하 ""근로자""라 함)은(는) 다음과 같이 근로계약을 체결한다."`,
        S.company + ' (이하 "사업주"라 함)과(와) ' + w.name + ' (이하 "근로자"라 함)은(는) 다음과 같이 근로계약을 체결한다.'));
      wsC.getRow(b + 3).height = 34;
      line(5, '1. 근로계약기간', f(`${dateTxt(W('L'))}&" 부터  "&${dateTxt(W('M'))}&" 까지"`, ymdTxt(row.first) + ' 부터  ' + ymdTxt(row.lastWork) + ' 까지'));
      line(6, '2. 근 무 장 소', f(`${SET(3)}&IF(${SET(5)}="",""," ("&${SET(5)}&")")`, S.site + (S.siteAddr ? ' (' + S.siteAddr + ')' : '')));
      line(7, '3. 업무의 내용(직종)', f(`${W('E')}`, w.job));
      line(8, '4. 소정근로시간', f(`${SET(13)}&" ~ "&${SET(14)}&"  (휴게시간 : "&${SET(15)}&")"`, S.workStart + ' ~ ' + S.workEnd + '  (휴게시간 : ' + S.breakTime + ')'));
      line(9, '5. 근무일 / 휴일', f(`"현장 작업일정에 따라 근무 / 주휴일 : 매주 "&${SET(16)}`, '현장 작업일정에 따라 근무 / 주휴일 : 매주 ' + S.holiday));
      put(10, 2, '6. 임    금', { bold: true });
      line(11, '   - 일급', f(`TEXT(${W('F')},"#,##0")&" 원"`, fmtWon(row.wage) + ' 원'));
      line(12, '   - 상여금 / 기타수당', '없음 / 없음');
      line(13, '   - 임금지급일', f(`"매월 "&${SET(12)}&"일 (휴일의 경우는 전일 지급)"`, '매월 ' + S.payDay + '일 (휴일의 경우는 전일 지급)'));
      line(14, '   - 지급방법', f(`"근로자 명의 예금통장에 입금"&IF(${W('J')}&${W('K')}="",""," ("&${W('J')}&" "&${W('K')}&")")`,
        '근로자 명의 예금통장에 입금' + (w.bank || w.acct ? ' (' + w.bank + ' ' + w.acct + ')' : '')));
      line(15, '7. 연차유급휴가', '근로기준법에서 정하는 바에 따라 부여함');
      line(16, '8. 사회보험 적용여부', f(`"☑ 고용보험   ☑ 산재보험   "&IF(${insCell}="Y","☑","☐")&" 국민연금   "&IF(${insCell}="Y","☑","☐")&" 건강보험"`,
        '☑ 고용보험   ☑ 산재보험   ' + (row.ins ? '☑' : '☐') + ' 국민연금   ' + (row.ins ? '☑' : '☐') + ' 건강보험'));
      line(17, '9. 근로계약서 교부', '사업주는 근로계약을 체결함과 동시에 본 계약서를 사본하여 근로자의 교부요구와 관계없이 근로자에게 교부함 (근로기준법 제17조 이행)', 34);
      line(18, '10. 기    타', '이 계약에 정함이 없는 사항은 근로기준법령에 의함');
      wsC.mergeCells(b + 20, 2, b + 20, 6);
      put(20, 2, f(`${dateTxt(W('L'))}`, ymdTxt(row.first)), { h: 'center', bold: true, size: 11 });
      put(22, 2, '(사업주)', { bold: true });
      line(23, '   사업체명', f(`${SET(6)}&IF(${SET(9)}="","","   (전화 : "&${SET(9)}&")")`, S.company + (S.bizTel ? '   (전화 : ' + S.bizTel + ')' : '')));
      line(24, '   주    소', f(`${SET(8)}&""`, S.bizAddr));
      line(25, '   대 표 자', f(`${SET(7)}&"                         (서명)"`, S.ceo + '                         (서명)'));
      put(27, 2, '(근로자)', { bold: true });
      line(28, '   주    소', f(`${W('H')}&""`, w.addr));
      line(29, '   연 락 처', f(`${W('I')}&""`, w.tel));
      line(30, '   성    명', f(`${W('B')}&"                         (서명)"`, w.name + '                         (서명)'));
      line(31, '   생년월일', f(`${W('C')}&""`, w.birth));
      for (let c = 2; c <= 6; c++) { wsC.getCell(b + 2, c).border = { top: { style: 'medium', color: { argb: 'FF333333' } } }; }
      for (let r = b + 4; r <= b + 31; r++) if (!wsC.getRow(r).height) wsC.getRow(r).height = 21;
      wsC.getRow(b + BLOCK - 1).addPageBreak();
    });
    wsC.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.5, header: 0.2, footer: 0.2 } };

    wb.views = [{ activeTab: 4 }];
    return { wb, st };
  }

  // ---------- 샘플 데이터 ----------
  function sampleRows() {
    const people = [
      ['김정호', '1968-04-12', '특별인부'], ['이상철', '1972-09-03', '비계공'], ['박영수', '1965-01-27', '보통인부'],
      ['최민규', '1980-11-15', '용접공'], ['정대현', '1975-06-30', '보통인부'], ['한석진', '1970-02-08', '도장공'],
      ['오세훈', '1983-07-19', '특별인부'], ['윤재석', '1962-12-01', '보통인부'], ['장호철', '1977-03-22', '비계공'],
      ['서동욱', '1988-08-09', '용접공']
    ];
    const plan = [22, 20, 21, 16, 7, 12, 19, 5, 18, 14];
    const out = [['순번', '현장명', '성명', '생년월일', '직종', '근무일자', '출근시간', '퇴근시간']];
    let seq = 1; const y = 2026, m = 10;
    const days = []; for (let d = 1; d <= 31; d++) { const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (dow !== 0) days.push(d); }
    people.forEach((p, pi) => {
      const n = plan[pi];
      const picks = days.filter((d, k) => ((k * 7 + pi * 3) % days.length) < n || k < 0).slice(0, n);
      picks.forEach((d, k) => {
        const inM = 6 * 60 + 40 + ((pi * 7 + d * 3) % 18);
        let outM = 17 * 60 + ((pi * 5 + d) % 12);
        if (pi === 3 && k % 6 === 0) outM = 12 * 60 + 5; // 반일 근무
        const date = y + '-' + pad(m) + '-' + pad(d);
        const t = (x) => pad(Math.floor(x / 60)) + ':' + pad(x % 60);
        if (pi === 4 && k === 2) { out.push([seq++, '공릉천교', p[0], p[1], p[2], date, t(inM), '']); return; } // 퇴근 미태그
        out.push([seq++, '공릉천교', p[0], p[1], p[2], date, t(inM), t(outM)]);
        if (pi === 1 && k === 4) out.push([seq++, '공릉천교', p[0], p[1], p[2], date, t(inM + 3), '']); // 중복 태그
      });
    });
    return out;
  }
  function sampleJobRates() {
    return [
      { job: '보통인부', wage: 172000 }, { job: '특별인부', wage: 225000 }, { job: '비계공', wage: 290000 },
      { job: '용접공', wage: 275000 }, { job: '도장공', wage: 260000 }
    ];
  }

  const api = { defaultSettings, detectHeader, classify, extractRecords, monthsOf, buildWorkers, computeStatement, buildWorkbook,
    gongsuOf, hoursOf, wageOf, lastDayOf, normDate, normTime, normBirth, sampleRows, sampleJobRates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LaborCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
