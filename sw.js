// ZStrike service worker: caches the static game files so it loads fast / offline (solo mode).
// Never touches the multiplayer WebSocket (/ws), /health, Solana RPC or any cross-origin request.
const CACHE = 'zstrike-v14';
const ASSETS = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'game.js', 'wallet.js', 'map.js', 'ai.js', 'config.js', 'weapons3d.js', 'voxguns.js', 'match.js',
  'vendor/three.module.min.js', 'vendor/solana-web3.iife.min.js', 'vendor/buffer-polyfill.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;           // RPC, CoinGecko, Phantom...
  if (url.pathname.endsWith('/ws') || url.pathname.endsWith('/health')) return; // live server endpoints
  if (req.headers.get('upgrade') === 'websocket') return;
  // network-first so new deploys show up right away; cache is the offline fallback
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
});
