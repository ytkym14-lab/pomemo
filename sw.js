// アプリ本体をキャッシュして、起動を速くし、圏外でも開けるようにする。
const CACHE = "pomemo-v2";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./firebase-config.js", "./manifest.webmanifest",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFirebaseSdk = url.hostname === "www.gstatic.com" && url.pathname.includes("/firebasejs/");
  if (!sameOrigin && !isFirebaseSdk) return; // Firestoreの通信などはSDKに任せる

  if (isFirebaseSdk) {
    // バージョン固定のURLなので、キャッシュ優先
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // 自分のファイルは、キャッシュをすぐ返しつつ裏で更新（stale-while-revalidate）
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await c.match("./index.html") : null);
    const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || fresh;
  }));
});
