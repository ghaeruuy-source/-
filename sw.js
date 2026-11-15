// Minimal service worker: makes the app installable and caches the shell.
const CACHE = "jayek-v39";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "icon.svg", "icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // never cache API calls
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "جايك بالطريق", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || d.app || "جايك بالطريق", {
    body: d.body || "", tag: d.tag, renotify: true, silent: false, requireInteraction: !!d.requireInteraction || /طلب جديد/.test(d.title || ""),
    vibrate: d.vibrate || [600, 150, 600, 150, 600, 150, 900], icon: "icon-192.png", badge: "icon-192.png", dir: "rtl", lang: "ar",
    data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    return c ? c.focus() : clients.openWindow(url);
  }));
});
