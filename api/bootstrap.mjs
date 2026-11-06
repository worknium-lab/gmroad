// 기본 관리자 계정(gmconst) 만들기 · 한 번만 실행
//   docker compose run --rm api node bootstrap.mjs
// 임시 비밀번호로 만들고, 첫 로그인 때 비밀번호를 직접 정하게 합니다.
import { admin, idToEmail } from './lib.mjs';

const username = process.env.ADMIN_USERNAME || 'gmconst';
const password = process.env.ADMIN_TEMP_PASSWORD || 'gmconst';

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
let user = list?.users.find((u) => u.email === idToEmail(username));
if (!user) {
  const { data, error } = await admin.auth.admin.createUser({ email: idToEmail(username), password, email_confirm: true, user_metadata: { username } });
  if (error) { console.error('계정 생성 실패:', error.message); process.exit(1); }
  user = data.user;
  console.log(`인증 계정 생성: ${username}`);
} else {
  console.log(`이미 있는 계정: ${username} (비밀번호는 바꾸지 않음)`);
}
const { data: co } = await admin.from('companies').select('id').eq('code', 'gmroad').single();
const { error } = await admin.from('profiles').upsert({ id: user.id, username, name: '기본 관리자', role: 'system_admin', company_id: co?.id, must_change_password: true }, { onConflict: 'id', ignoreDuplicates: true });
if (error) { console.error('프로필 생성 실패:', error.message, '\n→ 001_init.sql 마이그레이션을 먼저 적용했는지, 수파베이스 REST 설정에 gm 스키마를 넣었는지 확인하세요.'); process.exit(1); }
console.log(`\n완료. 아이디 ${username} / 임시 비밀번호 ${password}\n첫 로그인 때 새 비밀번호를 정하는 화면이 나옵니다.`);
