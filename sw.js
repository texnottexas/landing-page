'use strict';

// --- IndexedDB notification inbox ---
var INBOX_DB = 'tw2864-notifications';
var INBOX_STORE = 'inbox';
var INBOX_TTL = 14 * 86400000; // 14 days in ms

function generateId() {
  return self.crypto && self.crypto.randomUUID
    ? self.crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function openInboxDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(INBOX_DB, 1);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(INBOX_STORE)) {
        var store = db.createObjectStore(INBOX_STORE, { keyPath: 'id' });
        store.createIndex('expiresAt', 'expiresAt');
      }
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

// Service worker for 2864tw.com push notifications
// Minimal — no caching strategy (GitHub Pages CDN is fast enough)

// Push subscription self-heal. Kept in sync with index.html's PUSH_WORKER +
// VAPID_PUBLIC_KEY (the public key is safe to embed). When the browser rotates
// or invalidates the push subscription it fires `pushsubscriptionchange`; we
// mint a fresh subscription and re-register it so notifications keep working
// with no player action. The SW can't read localStorage, so identity is posted
// as null here and re-attached by index.html's saveSubToWorker on next load.
var PUSH_WORKER = 'https://push-worker.27tb8s6fct.workers.dev';
var VAPID_PUBLIC_KEY = 'BKbuearRTBpH6pAjoky9HVOYehah7lQ1Uti3APPMAYvdZJCUI8COAmVK7hym7zmefTGnI9_-vQY86IXa_nCHXHc';

function swUrlB64ToUint8Array(b64) {
  var pad = '='.repeat((4 - b64.length % 4) % 4);
  var base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(base64);
  return Uint8Array.from(raw, function(c) { return c.charCodeAt(0); });
}

function swBufToB64u(buf) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function swRegisterSub(sub) {
  return fetch(PUSH_WORKER + '/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: swBufToB64u(sub.getKey('p256dh')), auth: swBufToB64u(sub.getKey('auth')) },
      player: null,
    }),
  });
}

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('pushsubscriptionchange', function(event) {
  event.waitUntil(
    Promise.resolve(event.newSubscription).then(function(fresh) {
      if (fresh) return fresh;
      return self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: swUrlB64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }).then(function(sub) {
      return sub ? swRegisterSub(sub) : null;
    }).catch(function() { /* best-effort; page-load reconcile is the fallback */ })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}

  var title  = data.title  || 'TW Server 2864';
  var options = {
    body:    data.body   || '',
    icon:    data.icon   || '/icons/icon-192.png',
    badge:   data.badge  || '/icons/icon-192.png',
    tag:     data.tag    || 'tw2864-push',
    renotify: true,
    data:    { url: data.url || 'https://2864tw.com' },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  var showPromise = self.registration.showNotification(title, options);

  // Persist admin notifications to IndexedDB for in-app inbox
  var dbPromise = Promise.resolve();
  if (data.tag && data.tag.indexOf('manual-') === 0) {
    dbPromise = openInboxDB().then(function(db) {
      var now = Date.now();
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(INBOX_STORE, 'readwrite');
        tx.objectStore(INBOX_STORE).add({
          id: generateId(),
          title: title,
          body: options.body,
          url: data.url || '',
          tag: data.tag,
          receivedAt: now,
          expiresAt: now + INBOX_TTL,
          read: false
        });
        tx.oncomplete = resolve;
        tx.onerror = function() { reject(tx.error); };
      });
    }).catch(function() { /* IndexedDB unavailable — degrade silently */ });
  }

  event.waitUntil(Promise.all([showPromise, dbPromise]));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'https://2864tw.com';
  // Allow external URLs (Discord, etc.) — open in new window
  var isExternal = targetUrl.indexOf('https://2864tw.com') !== 0;

  event.waitUntil(
    isExternal
      ? self.clients.openWindow(targetUrl)
      : self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
          var norm = function(u) { return u.split('?')[0].split('#')[0].replace(/\/index\.html$/, '').replace(/\/+$/, ''); };
          var targetNorm = norm(targetUrl);
          for (var i = 0; i < clients.length; i++) {
            if (clients[i].url.startsWith('https://2864tw.com') && 'focus' in clients[i]) {
              if (norm(clients[i].url) !== targetNorm && 'navigate' in clients[i]) {
                return clients[i].navigate(targetUrl).then(function(c) { return c.focus(); });
              }
              return clients[i].focus();
            }
          }
          return self.clients.openWindow(targetUrl);
        })
  );
});
