// 최소 서비스워커: 앱 껍데기만 캐시하고, 데이터는 항상 서버에서 받습니다.
const CACHE = 'gm-shell-v2';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api') || url.pathname === '/config.js') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && url.pathname.startsWith('/assets/')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});

// ---------- 앱 푸시: 잠금화면 알림 ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'GM 통합관리', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'GM 통합관리', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/notifications' },
    icon: '/icon-192.png', badge: '/icon-192.png', lang: 'ko', vibrate: [120, 60, 120],
  }));
});
// 알림을 누르면: 이미 열린 창이 있으면 그 창으로, 없으면 새 창
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/notifications', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.location.origin));
    if (c) return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : null)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
// 브라우저가 구독을 바꾸면 다시 등록하도록 열린 창에 알림
self.addEventListener('pushsubscriptionchange', () => {
  self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'push-resubscribe' })));
});
