// Offline shell for receive practice. App files: network first (so updates
// land right away), cache as fallback. Art and audio: cache first.
// The API is never cached: guard verdicts and progress must be live.
const CACHE = 'cybercw-v8';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'core.wasm', 'icons/icon.svg', 'icons/icon-192.png',
  'js/main.js', 'js/gfx.js', 'js/core.js', 'js/audio.js', 'js/keyer-worklet.js', 'js/store.js', 'js/build.js', 'js/paddle.js', 'js/content.js',
  'js/scenes/common.js', 'js/scenes/title.js', 'js/scenes/hub.js', 'js/scenes/intercept.js', 'js/scenes/rush.js',
  'js/scenes/relay.js', 'js/scenes/contact.js', 'js/scenes/story.js', 'js/scenes/results.js', 'js/scenes/settings.js', 'js/scenes/drill.js', 'js/scenes/pileup.js', 'js/scenes/headcopy.js', 'js/scenes/coach.js',
  'js/scenes/fields.js', 'js/scenes/ladder.js', 'js/scenes/scope.js', 'js/scenes/quickdraw.js', 'js/scenes/drop.js', 'js/scenes/wall.js',
  'assets/fonts/vt323.woff2', 'assets/fonts/sharetechmono.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Music streams with Range requests; let the browser handle those itself.
  if (e.request.method !== 'GET' || url.pathname.includes('/api/') || url.pathname.includes('/assets/audio/')) return;
  const asset = url.pathname.includes('/assets/');
  if (asset) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
