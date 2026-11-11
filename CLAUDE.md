# CLAUDE.md — GM 통합관리도구

## 프로젝트
지엠로드 · 지엠알 · OO엔지니어링 3개 회사 통합관리도구. 사용자는 한국 건설업(교량 보수보강 · 특허공법) 실무자. UI 문구는 모두 한국어, 쉬운 말.

## 스택
- DB/인증/파일/실시간: Supabase 셀프호스팅 (홈 서버 `~/supabase/docker`), **모든 테이블은 `gm` 스키마** (`public`은 다른 앱이 씀)
- 웹: React 18 + Vite + TypeScript, 라우터 react-router v6, 상태관리 라이브러리 없음, CSS는 `web/src/styles.css` 토큰 · 클래스
- 관리 API: `api/server.mjs` (Node 내장 http, service role 필요한 작업만)
- 배포: docker compose (web nginx + api), 브라우저 → `/sb` 프록시 → Kong

## 규칙 (반드시)
- 금액은 정수(bigint). 곱셈은 `trunc(a*b)` / 프론트는 `mul()` (`lib/format.ts`)
- 권한은 RLS가 진실. 프론트 권한 체크는 화면 표시용일 뿐
- 현장 수량(`progress_entries`)은 pending으로만 들어가고 본사(can_edit)가 승인 — 트리거로 강제
- 파일 경로: `{project_id}/{분류}/...` (storage 정책이 첫 폴더로 프로젝트 권한 판단)
- DB 변경은 `supabase/migrations/NNN_*.sql` 새 파일로만. 적용된 파일 수정 금지
- 라이선스: gm 스키마의 새 테이블은 이벤트 트리거로 쓰기 잠금이 자동으로 붙음 (예외 목록은 `gm.license_guard_all`). 관리 API에 새 POST를 만들면 읽기 전용 때 허용할지 `api/server.mjs`의 `READONLY_OK`에 판단해 넣을 것. `api/license/pubkey.mjs`는 release.sh가 덮어씀 (손대지 말 것)
- 디자인 기준: v2 캔버스 (남색 #14243D 메뉴, 주색 #1F4E8C, 현장 청록 #0F6E61, 강조 #F0A35E, Noto Sans KR, 터치 44px 이상)

## 다음 단계 후보
완료: ④ 내역서 · ⑨ 노무비 · ⑩ 회의록 · 공용공간 · 사진 앱(/photos) · 제품 · 실적(/products) · 앱 푸시(api/push, gm.notifications → 5초 폴링).
완료(계속): 라이선스(licensing/server = WORKNIUM 쪽, api/license = 고객 쪽, 011 DB 잠금, scripts/release.sh).
완료(11월): 참고 현장(RefSites, 발주처 기준) · 워크니움 공지 팝업(라이선스 서버 db.notices → /lic/v1/notices → api/notices/sync.mjs 10분 → gm.vendor_notices → lib/notices.tsx).
남은 것: 메신저(설계만), 위치별 구조화 AI(Claude API). (CALS 공고 메뉴는 제외하기로 함 — 사이트가 자동 수집을 막음)
