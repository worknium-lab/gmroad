// 프로그램 파일 지문 (배포판을 만들 때 목록을 만들고, 실행 중에 같은 방법으로 다시 계산해 비교)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIR = new Set(['node_modules', '.git']);
const OK_EXT = /\.(mjs|cjs|js|json)$/;
export const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** API 폴더의 코드 파일 지문 { '상대경로': sha256 } */
export function hashDir(root) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIR.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (OK_EXT.test(e.name) && e.name !== 'package-lock.json') out['api/' + path.relative(root, p).split(path.sep).join('/')] = sha(fs.readFileSync(p));
    }
  };
  walk(root);
  return out;
}

/** 웹 파일 지문 — 웹 컨테이너에서 실제로 내려주는 파일을 받아서 계산 (config.js는 설치마다 달라서 뺌) */
export async function hashWeb(base, files) {
  const out = {};
  for (const f of files) {
    try { const r = await fetch(base + '/' + f); out['web/' + f] = r.ok ? sha(Buffer.from(await r.arrayBuffer())) : 'missing:' + r.status; }
    catch (e) { out['web/' + f] = 'error'; }
  }
  return out;
}
/** 배포판을 만들 때: dist 폴더의 파일 목록 */
export function listWebDist(dist) {
  const out = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else out.push(path.relative(dist, p).split(path.sep).join('/')); } };
  walk(dist);
  return out.filter((f) => f !== 'config.js').sort();
}
