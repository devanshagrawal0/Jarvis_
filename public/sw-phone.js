// JARVIS Phone PWA — Service Worker
// Handles: app shell caching, background sync for outbound queue, push notifications.

const CACHE = "jarvis-phone-v1";
const SHELL = [
  "/phone.html",
  "/phone-manifest.webmanifest",
];

// ─── Install: cache app shell ─────────────────────────────────────────────────

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: serve shell from cache, network-first for API ────────────────────

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Always network for API and WebSocket upgrade paths
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mesh/")) return;

  // App shell: cache-first
  if (url.pathname === "/phone.html" || url.pathname === "/phone-manifest.webmanifest") {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
    return;
  }

  // JS/CSS assets (hashed): cache-first with network fallback
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(e.request);
        if (cached) return cached;
        const fresh = await fetch(e.request);
        c.put(e.request, fresh.clone());
        return fresh;
      })
    );
  }
});

// ─── Background Sync: flush outbound queue ───────────────────────────────────

self.addEventListener("sync", (e) => {
  if (e.tag === "jarvis-outbound") {
    e.waitUntil(flushOutboundQueue());
  }
});

async function flushOutboundQueue() {
  const db = await openQueue();
  const items = await getAllItems(db);
  const token = await getToken();
  for (const item of items) {
    try {
      await fetch(item.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: item.body,
      });
      await deleteItem(db, item.id);
    } catch {
      // Will retry on next sync
    }
  }
}

// ─── Push Notifications ───────────────────────────────────────────────────────

self.addEventListener("push", (e) => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { return; }
  const title = data.title || "JARVIS";
  const options = {
    body: data.body || data.summary || "",
    icon: "/icons/phone-icon-192.png",
    badge: "/icons/phone-badge-72.png",
    tag: data.tag || "jarvis-notification",
    requireInteraction: Boolean(data.requireInteraction),
    vibrate: data.needsApproval ? [80, 60, 80, 60, 200] : [100],
    data: data,
    actions: data.needsApproval
      ? [
          { action: "approve", title: "Approve" },
          { action: "deny", title: "Deny" },
        ]
      : [],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};

  if (e.action === "approve" && data.requestId) {
    e.waitUntil(
      getToken().then((token) =>
        fetch("/mesh/api/pair/approve", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ requestId: data.requestId, trustLevel: "upload_only" }),
        })
      )
    );
    return;
  }

  if (e.action === "deny" && data.requestId) {
    e.waitUntil(
      getToken().then((token) =>
        fetch("/mesh/api/pair/deny", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ requestId: data.requestId }),
        })
      )
    );
    return;
  }

  // Default: focus the app
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow("/phone.html");
    })
  );
});

// ─── Messages from main thread ────────────────────────────────────────────────

self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (e.data?.type === "QUEUE_ITEM") {
    openQueue().then((db) => addItem(db, e.data.item));
  }
});

// ─── IndexedDB queue helpers ──────────────────────────────────────────────────

function openQueue() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("jarvis-sw-queue", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("items", { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllItems(db) {
  return new Promise((resolve) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

function addItem(db, item) {
  return new Promise((resolve) => {
    const tx = db.transaction("items", "readwrite");
    tx.objectStore("items").add(item);
    tx.oncomplete = resolve;
  });
}

function deleteItem(db, id) {
  return new Promise((resolve) => {
    const tx = db.transaction("items", "readwrite");
    tx.objectStore("items").delete(id);
    tx.oncomplete = resolve;
  });
}

async function getToken() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  // Token is in localStorage — try to get it from an open client via postMessage
  // Fallback: use a cached token stored in the SW cache
  try {
    const c = await caches.open(CACHE);
    const r = await c.match("/__jarvis_token__");
    if (r) return await r.text();
  } catch {}
  return "";
}
