// 라이선스 파일 형식 — 전자서명(Ed25519) + 암호화(AES-256-GCM)
//   GMLIC1.<base64url( iv(12) | 암호문 | tag(16) )>
//   암호문을 풀면 { p: 내용, s: 서명 } — 서명은 WORKNIUM 라이선스 서버의 개인키로만 만들 수 있음
//   내용을 한 글자라도 바꾸면 서명이 맞지 않아 무효
import crypto from 'node:crypto';

const PREFIX = 'GMLIC1.';
const b64u = (b) => Buffer.from(b).toString('base64url');
const encKey = (pubB64) => crypto.createHash('sha256').update('GM-LICENSE-ENC-v1:' + pubB64).digest();
/** 서명할 때와 검증할 때 똑같은 순서로 직렬화 */
export const canon = (o) => JSON.stringify(Object.keys(o).sort().reduce((a, k) => ((a[k] = o[k]), a), {}));

export function pubFromRaw(pubB64) {
  const raw = Buffer.from(pubB64, 'base64');
  if (raw.length !== 32) throw new Error('공개키 길이가 맞지 않습니다');
  return crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
}
export function rawFromPub(pubKey) { return pubKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64'); }

/** (라이선스 서버 전용) 서명 + 암호화 */
export function issue(payload, privateKey, pubB64) {
  const s = b64u(crypto.sign(null, Buffer.from(canon(payload)), privateKey));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(pubB64), iv);
  const enc = Buffer.concat([c.update(JSON.stringify({ p: payload, s })), c.final()]);
  return PREFIX + b64u(Buffer.concat([iv, enc, c.getAuthTag()]));
}

/** (고객 서버) 풀고 서명 검증 — 실패하면 예외 */
export function open(token, pubB64) {
  if (typeof token !== 'string' || !token.startsWith(PREFIX)) throw new Error('라이선스 형식이 아닙니다');
  const buf = Buffer.from(token.slice(PREFIX.length).trim(), 'base64url');
  if (buf.length < 30) throw new Error('라이선스가 손상되었습니다');
  let plain;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(pubB64), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    plain = JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString());
  } catch { throw new Error('라이선스를 풀 수 없습니다 (다른 서버용이거나 손상됨)'); }
  const ok = crypto.verify(null, Buffer.from(canon(plain.p)), pubFromRaw(pubB64), Buffer.from(plain.s || '', 'base64url'));
  if (!ok) throw new Error('라이선스 서명이 맞지 않습니다 (위조 또는 변조)');
  return plain.p;
}
