// Network-first with cache fallback (offline). Versioned so old caches are purged on update.
const C = 'pholama-v38';
const F = ['./', 'index.html', 'app.js', 'memlimit.js', 'duo.js', 'reader.js', 'attachui.js', 'attach.js', 'editlog.js', 'thinking.js', 'fallback.js', 'style.css', 'account.js', 'pclink.js', 'cloud.js', 'remote.js', 'loader.js', 'config.js', 'models.json', 'releases.json', 'dashboard.js', 'info.js', 'platform.js', 'platformui.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(F.map(u => new Request(u, { cache: 'reload' }))))); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
