// 앱 푸시 (Web Push) — 이 기기에서 잠금화면 알림 받기
import { sb, q, api } from './supabase';

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

/** 기기 이름 (등록 목록에 보이는 이름) */
export function deviceName() {
  const u = navigator.userAgent;
  const os = /Android/.test(u) ? '안드로이드' : isIOS() ? (/iPad/.test(u) || navigator.maxTouchPoints > 1 && /Mac/.test(u) ? '아이패드' : '아이폰') : /Windows/.test(u) ? '윈도우 PC' : /Mac/.test(u) ? '맥' : '기기';
  const br = /SamsungBrowser/.test(u) ? '삼성 인터넷' : /Edg\//.test(u) ? '엣지' : /Chrome\//.test(u) && !/Edg/.test(u) ? '크롬' : /Firefox/.test(u) ? '파이어폭스' : /Safari/.test(u) ? '사파리' : '브라우저';
  return `${os} · ${br}${standalone() ? ' (앱)' : ''}`;
}

async function reg() {
  const r = await navigator.serviceWorker.getRegistration();
  return r || navigator.serviceWorker.register('/sw.js');
}

export async function pushState(): Promise<PushState> {
  if (isIOS() && !standalone()) return 'ios-install';     // 아이폰은 '홈 화면에 추가'한 앱에서만 푸시 가능 (iOS 16.4+)
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const r = await navigator.serviceWorker.getRegistration();
  const sub = await r?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

async function save(sub: PushSubscription) {
  const j = sub.toJSON() as any;
  await q(sb.rpc('push_register', { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: deviceName() }));
}

/** 켜기 — 버튼을 누른 순간에 불러야 함 (브라우저가 그때만 허락 창을 띄움) */
export async function enablePush() {
  if (!supported()) throw new Error('이 브라우저는 알림을 지원하지 않습니다');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? '알림이 차단되어 있습니다. 브라우저 설정에서 이 사이트 알림을 허용해 주세요' : '알림 허락을 받지 못했습니다');
  const { publicKey } = await api('/api/push/key');
  const r = await reg(); await navigator.serviceWorker.ready;
  let sub = await r.pushManager.getSubscription();
  // 서버 키가 바뀌었으면 새로 구독
  const cur = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey as ArrayBuffer) : null;
  const want = b64(publicKey);
  if (sub && cur && (cur.length !== want.length || cur.some((v, i) => v !== want[i]))) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await save(sub);
}

export async function disablePush() {
  const r = await navigator.serviceWorker.getRegistration();
  const sub = await r?.pushManager.getSubscription();
  if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
}

/** 로그인할 때마다: 이미 켜 둔 기기면 지금 로그인한 사람으로 다시 등록 (같은 폰을 여러 사람이 쓸 때) */
export async function syncPush() {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    const r = await navigator.serviceWorker.getRegistration();
    const sub = await r?.pushManager.getSubscription();
    if (sub) await save(sub);
  } catch { /* 조용히 무시 */ }
}
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener?.('message', (e) => { if (e.data?.type === 'push-resubscribe') enablePush().catch(() => {}); });
}

export const testPush = () => api('/api/push/test', {});

/** 로그아웃: 이 기기로 가던 알림을 먼저 끊고 나감 (다음 사람이 로그인하면 그 사람으로 다시 등록) */
export async function logout() {
  try {
    const r = await navigator.serviceWorker?.getRegistration();
    const sub = await r?.pushManager.getSubscription();
    if (sub) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  } catch { /* 무시 */ }
  await sb.auth.signOut();
}
