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

self.addEventListener('install', function(event) {
  self.skipWaiting();
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
          title: data.title || 'TW Server 2864',
          body: data.body || '',
          url: data.url || '',
          tag: data.tag,
          receivedAt: now,
          expiresAt: now + INBOX_TTL
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
          for (var i = 0; i < clients.length; i++) {
            if (clients[i].url.startsWith('https://2864tw.com') && 'focus' in clients[i]) {
              if (clients[i].url !== targetUrl && 'navigate' in clients[i]) {
                return clients[i].navigate(targetUrl).then(function(c) { return c.focus(); });
              }
              return clients[i].focus();
            }
          }
          return self.clients.openWindow(targetUrl);
        })
  );
});
