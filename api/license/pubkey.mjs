// 배포판을 만들 때 scripts/release.sh가 WORKNIUM 라이선스 서버의 공개키로 채웁니다.
// 개발판(이 파일이 null)은 처음 연결할 때 라이선스 서버에서 받아 DB에 고정합니다.
export const PUBKEY = null;
export const VERSION = 'dev';
export const WEB_FILES = [];
