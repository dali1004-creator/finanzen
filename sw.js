// Service Worker: hält die App-Dateien offline vor. Er lädt nur eigene Dateien
// und sieht nie Finanzdaten (die liegen im Speicher der Seite, nicht im Cache).
// Bei jeder Code-Änderung VERSION erhöhen, sonst behält das iPhone die alte Fassung.
const VERSION = 'finanzen-v1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'logic.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
