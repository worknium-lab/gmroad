// 앱 푸시 (Web Push) — 새 알림을 몇 초마다 모아 각자의 폰 · PC로 보냄
import webpush from 'web-push';
import { admin } from '../lib.mjs';

let keys = null;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@gm.local';

/** 푸시 키: DB에 있으면 그대로, 없으면 처음 한 번 만들어 저장 (바꾸면 모든 기기 재등록이 필요하므로 절대 다시 만들지 않음) */
export async function pushKeys() {
  if (keys) return keys;
  const { data, error } = await admin.from('push_keys').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error('push_keys 읽기 실패: ' + error.message);
  if (data) keys = { publicKey: data.public_key, privateKey: data.private_key };
  else {
    const k = webpush.generateVAPIDKeys();
    const { error: e2 } = await admin.from('push_keys').insert({ id: 1, public_key: k.publicKey, private_key: k.privateKey });
    if (e2) { const { data: again } = await admin.from('push_keys').select('*').eq('id', 1).single(); keys = { publicKey: again.public_key, privateKey: again.private_key }; }
    else keys = k;
    console.log('푸시 키를 새로 만들었습니다');
  }
  webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
  return keys;
}

/** 한국 시간 밤 10시 ~ 아침 7시 */
export const isNight = (d = new Date()) => { const h = (d.getUTCHours() + 9) % 24; return h >= 22 || h < 7; };

export async function sendTo(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'high' });
    await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq('id', sub.id);
    return true;
  } catch (e) {
    const code = e.statusCode;
    if (code === 404 || code === 410 || (sub.fail_count || 0) >= 20) await admin.from('push_subscriptions').delete().eq('id', sub.id);   // 앱 지움 · 알림 끔
    else await admin.from('push_subscriptions').update({ fail_count: (sub.fail_count || 0) + 1 }).eq('id', sub.id);
    if (code !== 404 && code !== 410) console.error('푸시 실패', code || '', e.body || e.message);
    return false;
  }
}

let busy = false;
export async function pushTick() {
  if (busy) return; busy = true;
  try {
    await pushKeys();
    const { data: rows, error } = await admin.from('notifications').select('id, user_id, title, body, link, created_at').is('pushed_at', null).order('created_at').limit(300);
    if (error) throw new Error(error.message);
    if (!rows?.length) return;
    // 먼저 '보냄' 표시 (중복 방지) — 실제로 표시된 것만 보냄
    const { data: claimed } = await admin.from('notifications').update({ pushed_at: new Date().toISOString() }).in('id', rows.map((r) => r.id)).is('pushed_at', null).select('id');
    const ok = new Set((claimed || []).map((r) => r.id));
    const fresh = rows.filter((r) => ok.has(r.id) && Date.now() - new Date(r.created_at).getTime() < 24 * 3600e3);
    if (!fresh.length) return;
    const users = [...new Set(fresh.map((r) => r.user_id))];
    const [{ data: subs }, { data: prefs }] = await Promise.all([
      admin.from('push_subscriptions').select('*').in('user_id', users),
      admin.from('push_prefs').select('*').in('user_id', users),
    ]);
    const quiet = new Set((prefs || []).filter((p) => p.quiet_night).map((p) => p.user_id));
    const night = isNight();
    const jobs = [];
    for (const n of fresh) {
      if (night && quiet.has(n.user_id)) continue;
      for (const s of (subs || []).filter((x) => x.user_id === n.user_id))
        jobs.push(sendTo(s, { title: n.title, body: n.body || '', url: n.link || '/notifications', tag: n.id }));
    }
    await Promise.all(jobs);
  } catch (e) { console.error('푸시 처리 오류', e.message); }
  finally { busy = false; }
}

export function startPushWorker() {
  pushKeys().catch((e) => console.error('푸시 키 준비 실패 (DB 마이그레이션 010 확인)', e.message));
  setInterval(pushTick, 5000);
}

export const pushRoutes = {
  'GET /api/push/key': async () => ({ publicKey: (await pushKeys()).publicKey }),
  'POST /api/push/test': async (me) => {
    await pushKeys();
    const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', me.id);
    if (!subs?.length) throw [400, '이 계정에 등록된 기기가 없습니다. 먼저 [이 기기에서 알림 받기]를 켜세요'];
    const r = await Promise.all(subs.map((s) => sendTo(s, { title: '시험 알림', body: `${me.name || me.username} 님, 알림이 잘 옵니다.`, url: '/me', tag: 'test' })));
    return { sent: r.filter(Boolean).length, total: subs.length };
  },
};
